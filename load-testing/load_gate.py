#!/usr/bin/env python3
"""Puerta de rendimiento de MemTrace (ADR-096). Falla si un umbral de `thresholds.json` no se cumple.

Contra un clúster con MemTrace instalado (`make up` o el chart de Helm), este script:
  1. crea, solo en Postgres, un usuario (perfil `technical`), una organización, un experimento y una API key propios de esta ejecución;
  2. manda trazas por el mismo camino que un agente real (SDK → pasarela de la API → Collector → ClickHouse), con los agentes
     simulados de `agent_load_test.py`;
  3. espera a que lleguen a ClickHouse y cuenta las que faltan;
  4. mide el p95 de la API de consulta con una sesión del usuario creado;
  5. lee la memoria del Collector de sus propias métricas.

Uso:
  python3 load-testing/load_gate.py [--namespace memtrace] [--agents 50] [--rounds 4] [--report informe.json] [--no-fail]

Necesita `kubectl` apuntando al clúster y el SDK de Python (`pip install -e sdk/python`). No necesita login: la sesión se
inserta en Postgres. Cada ejecución deja un experimento `load-gate-<id>` y sus trazas; bórralos con `--cleanup`.
"""
import argparse
import asyncio
import json
import os
import secrets
import statistics
import subprocess
import sys
import time
import logging
import urllib.request
from hashlib import sha256
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "sdk" / "python"))
sys.path.insert(0, str(HERE))

API_PORT, COLLECTOR_METRICS_PORT = 13001, 18888
logging.disable(logging.ERROR)   # los agentes simulados fallan a propósito el 5 % de las veces


def sh(*cmd, input_text=None, check=True):
    r = subprocess.run(cmd, input=input_text, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit(f"FALLO ejecutando {' '.join(cmd[:4])}...: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout.strip()


class Cluster:
    def __init__(self, namespace):
        self.ns = namespace
        self.forwards = []

    def kubectl(self, *args, **kw):
        return sh("kubectl", "-n", self.ns, *args, **kw)

    def psql(self, sql):
        return self.kubectl("exec", "-i", "postgres-0", "--", "psql", "-U", "memtrace", "-d", "memtrace_identity",
                            "-At", "-v", "ON_ERROR_STOP=1", "-f", "-", input_text=sql)

    def clickhouse(self, query, check=True):
        pw = sh("kubectl", "-n", self.ns, "get", "secret", "clickhouse-credentials", "-o", "jsonpath={.data.password}")
        pw = subprocess.run(["base64", "-d"], input=pw, capture_output=True, text=True).stdout
        return self.kubectl("exec", "clickhouse-0", "-c", "clickhouse", "--", "clickhouse-client", "--password", pw,
                            "--query", query, check=check)

    def forward(self, target, local, remote):
        p = subprocess.Popen(["kubectl", "-n", self.ns, "port-forward", target, f"{local}:{remote}"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.forwards.append(p)
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{local}/", timeout=1)
                return
            except urllib.error.HTTPError:
                return   # responde (aunque sea 404): el túnel funciona
            except Exception:
                time.sleep(0.2)
        sys.exit(f"FALLO: no se pudo abrir el túnel a {target}")

    def close(self):
        for p in self.forwards:
            p.terminate()


def bootstrap(cl, run_id):
    """Crea lo mínimo en Postgres para ingerir y consultar sin pasar por el login. Devuelve ids y credenciales."""
    api_key = f"mtk_{secrets.token_urlsafe(24)}"
    session = secrets.token_urlsafe(32)
    service = f"load-gate-{run_id}"
    email = f"load-gate-{run_id}@example.test"
    out = cl.psql(f"""
WITH u AS (INSERT INTO users (name, email) VALUES ('Load gate {run_id}', '{email}') RETURNING id),
     o AS (INSERT INTO organizations (name) VALUES ('Load gate {run_id}') RETURNING id),
     m AS (INSERT INTO org_memberships (organization_id, user_id, role) SELECT o.id, u.id, 'org_admin' FROM o, u RETURNING 1),
     e AS (INSERT INTO experiments (organization_id, name, service_name) SELECT o.id, 'Load gate {run_id}', '{service}' FROM o RETURNING id),
     k AS (INSERT INTO api_keys (experiment_id, key_hash, key_prefix, created_by)
           SELECT e.id, '{sha256(api_key.encode()).hexdigest()}', '{api_key[:12]}', u.id FROM e, u RETURNING 1),
     x AS (INSERT INTO experiment_memberships (experiment_id, user_id, role) SELECT e.id, u.id, 'technical' FROM e, u RETURNING 1),
     s AS (INSERT INTO sessions ("userId", expires, "sessionToken") SELECT u.id, now() + interval '2 hours', '{session}' FROM u RETURNING 1)
SELECT e.id FROM e, m, k, x, s;
""")
    experiment_id = out.splitlines()[0].strip()
    return {"experiment_id": experiment_id, "service": service, "api_key": api_key, "session": session, "email": email}


def cleanup(cl):
    cl.psql("""
DELETE FROM organizations WHERE name LIKE 'Load gate %';
DELETE FROM users WHERE email LIKE 'load-gate-%@example.test';
""")
    cl.clickhouse("ALTER TABLE memtrace.otel_traces DELETE WHERE ServiceName LIKE 'load-gate-%' SETTINGS mutations_sync = 1")
    print("Limpio: organizaciones, usuarios y trazas de load-gate eliminados")


class CountingExporter:
    """Envuelve el exportador OTLP real y cuenta los spans que el SDK intenta enviar (lo que debe llegar a ClickHouse)."""
    attempted = 0
    rejected = 0

    def __init__(self, inner):
        self.inner = inner

    def export(self, spans):
        result = self.inner.export(spans)
        CountingExporter.attempted += len(spans)
        if getattr(result, "name", "SUCCESS") != "SUCCESS":
            CountingExporter.rejected += len(spans)
        return result

    def shutdown(self):
        return self.inner.shutdown()

    def force_flush(self, timeout_millis=30000):
        return self.inner.force_flush(timeout_millis)


async def send_load(creds, agents, rounds, burst_spans, api_port):
    import memtrace.adapters.outbound.otel.factory as factory
    from memtrace import init_tracer, shutdown, trace_step
    import agent_load_test as gen

    real_build = factory.build_otlp_exporter
    factory.build_otlp_exporter = lambda *a, **k: CountingExporter(real_build(*a, **k))
    init_tracer(service_name=creds["service"], endpoint=f"http://127.0.0.1:{api_port}/api/v1/ingest",
                protocol="http/protobuf", headers={"authorization": f"Bearer {creds['api_key']}"})
    runner = gen.LoadTestRunner(num_agents=agents)
    start = time.time()
    for r in range(rounds):
        await asyncio.gather(*[runner.run_agent(i) for i in range(agents)])

    @trace_step(name="Burst", step_type="tool")
    def burst(i):
        return i

    # ráfaga sin esperas: mide lo que aguanta la ingesta, no la lentitud de los agentes simulados
    burst_start = time.time()
    for i in range(burst_spans):
        burst(i)
    shutdown()   # vacía lo pendiente hacia la pasarela
    return CountingExporter.attempted, CountingExporter.rejected, burst_start


def wait_for_spans(cl, service, expected, timeout):
    deadline, seen = time.time() + timeout, 0
    while time.time() < deadline:
        out = cl.clickhouse(f"SELECT count() FROM memtrace.otel_traces WHERE ServiceName = '{service}'", check=False)
        seen = int(out) if out.isdigit() else 0   # ClickHouse caído: nada ha llegado
        if seen >= expected:
            break
        time.sleep(2)
    return seen, time.time()


def query_p95(creds, api_port, samples):
    url = f"http://127.0.0.1:{api_port}/api/v1/experiments/{creds['experiment_id']}/metrics/overview"
    req = lambda: urllib.request.Request(url, headers={"cookie": f"authjs.session-token={creds['session']}"})
    urllib.request.urlopen(req(), timeout=30).read()   # calentamiento (conexiones, caché de permisos)
    times = []
    for _ in range(samples):
        t = time.time()
        urllib.request.urlopen(req(), timeout=30).read()
        times.append((time.time() - t) * 1000)
    times.sort()
    return times[min(len(times) - 1, int(len(times) * 0.95))], statistics.median(times)


def collector_rss_mb(metrics_port):
    body = urllib.request.urlopen(f"http://127.0.0.1:{metrics_port}/metrics", timeout=10).read().decode()
    for line in body.splitlines():
        if line.startswith("otelcol_process_memory_rss"):
            return float(line.split()[-1]) / 1024 / 1024
    sys.exit("FALLO: el Collector no expone otelcol_process_memory_rss en :8888")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--namespace", default="memtrace")
    ap.add_argument("--agents", type=int, default=50, help="agentes simultáneos por ronda")
    ap.add_argument("--rounds", type=int, default=4)
    ap.add_argument("--burst-spans", type=int, default=3000, help="spans enviados sin esperas para medir la ingesta")
    ap.add_argument("--query-samples", type=int, default=40)
    ap.add_argument("--wait", type=int, default=90, help="segundos para que lleguen las trazas a ClickHouse")
    ap.add_argument("--thresholds", default=str(HERE / "thresholds.json"))
    ap.add_argument("--report", help="escribe el informe en JSON")
    ap.add_argument("--no-fail", action="store_true", help="solo medir (para fijar umbrales); no falla")
    ap.add_argument("--cleanup", action="store_true", help="borra lo que dejaron las ejecuciones y sale")
    a = ap.parse_args()

    cl = Cluster(a.namespace)
    if a.cleanup:
        return cleanup(cl)
    run_id = secrets.token_hex(3)
    try:
        creds = bootstrap(cl, run_id)
        cl.forward("svc/api", API_PORT, 3001)
        cl.forward("deploy/otel-collector", COLLECTOR_METRICS_PORT, 8888)
        print(f"Carga: {a.agents} agentes × {a.rounds} rondas contra {a.namespace} (servicio {creds['service']})")
        expected, rejected, started = asyncio.run(send_load(creds, a.agents, a.rounds, a.burst_spans, API_PORT))
        seen, landed_at = wait_for_spans(cl, creds["service"], expected, a.wait)
        try:
            p95, p50 = query_p95(creds, API_PORT, a.query_samples)
        except Exception as e:   # la API no responde (p. ej. ClickHouse caído): cuenta como incumplimiento, no como fallo del script
            print(f"La API de consulta falló: {e}")
            p95 = p50 = 999999.0
        rss = collector_rss_mb(COLLECTOR_METRICS_PORT)
    finally:
        cl.close()

    elapsed = max(landed_at - started, 0.001)   # desde que empieza la ráfaga hasta que todo está en ClickHouse
    result = {
        "spans_sent": expected, "spans_rejected_by_gateway": rejected, "spans_in_clickhouse": seen, "spans_lost": max(expected - seen, 0),
        "burst_spans": a.burst_spans, "spans_per_second": round(a.burst_spans / elapsed, 1), "query_p95_ms": round(p95, 1), "query_p50_ms": round(p50, 1),
        "collector_rss_mb": round(rss, 1), "elapsed_s": round(elapsed, 1),
    }
    limits = json.loads(Path(a.thresholds).read_text())
    checks = [
        ("spans_lost", result["spans_lost"], "<=", limits["max_spans_lost"]),
        ("spans_per_second", result["spans_per_second"], ">=", limits["min_spans_per_second"]),
        ("query_p95_ms", result["query_p95_ms"], "<=", limits["max_query_p95_ms"]),
        ("collector_rss_mb", result["collector_rss_mb"], "<=", limits["max_collector_rss_mb"]),
    ]
    failed = []
    print(f"\n{'medida':<20}{'valor':>12}{'umbral':>14}")
    for name, value, op, limit in checks:
        ok = value <= limit if op == "<=" else value >= limit
        print(f"{name:<20}{value:>12}{op + ' ' + str(limit):>14}  {'OK' if ok else 'FALLO'}")
        if not ok:
            failed.append(name)
    result["failed"] = failed
    if a.report:
        Path(a.report).write_text(json.dumps(result, indent=2))
    if failed and not a.no_fail:
        sys.exit(f"\nFALLO: se incumplen {', '.join(failed)}")
    print("\nOK" if not failed else "\n(medido sin fallar: --no-fail)")


if __name__ == "__main__":
    main()
