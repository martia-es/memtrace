/**
 * Monitoring opcional (ADR-098): Prometheus y Grafana. Comprueba su postura de red y de contenedores, y que las reglas y el
 * dashboard hablan de métricas que de verdad existen: si alguien renombra una métrica del servicio `ingest`, las alertas
 * dejarían de dispararse sin avisar.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAllDocuments, parse } from "yaml";

const ROOT = join(__dirname, "..", "..");
const DIR = join(ROOT, "k8s", "monitoring");
const CONFIG = join(DIR, "config");
type Doc = Record<string, any>;

const docs: Doc[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".yaml"))
  .flatMap((file) => parseAllDocuments(readFileSync(join(DIR, file), "utf8")).map((d) => d.toJS() as Doc))
  .filter((doc) => doc && typeof doc === "object");
const workloads = docs.filter((d) => ["Deployment", "StatefulSet"].includes(d.kind));
const policies = docs.filter((d) => d.kind === "NetworkPolicy");
const policy = (name: string) => policies.find((p) => p.metadata.name === name)!;
const app = (name: string) => workloads.find((w) => w.metadata.name === name)!;
const containers = (name: string): Doc[] => app(name).spec.template.spec.containers;
const apps = (rule: Doc) => (rule.to ?? rule.from).map((t: Doc) => t.podSelector.matchLabels.app);

describe("workloads", () => {
  it.each(["prometheus", "grafana"])("%s runs as non-root, drops privileges and has no Kubernetes API token", (name) => {
    const spec = app(name).spec.template.spec;
    expect(spec.securityContext.runAsNonRoot).toBe(true);
    expect(spec.automountServiceAccountToken).toBe(false);
    for (const c of spec.containers) {
      expect(c.securityContext.allowPrivilegeEscalation).toBe(false);
      expect(c.securityContext.capabilities.drop).toEqual(["ALL"]);
      expect(c.resources.limits.memory).toBeDefined();
    }
  });

  it("Prometheus has a read-only root filesystem and bounded retention", () => {
    const c = containers("prometheus")[0]!;
    expect(c.securityContext.readOnlyRootFilesystem).toBe(true);
    const args: string[] = c.args;
    expect(args.some((a) => a.startsWith("--storage.tsdb.retention.time="))).toBe(true);
    expect(args.some((a) => a.startsWith("--storage.tsdb.retention.size="))).toBe(true);
  });

  it("Grafana has no sign-up, no anonymous access and makes no calls home", () => {
    const env = Object.fromEntries(containers("grafana")[0]!.env.map((e: Doc) => [e.name, e.value]));
    expect(env.GF_USERS_ALLOW_SIGN_UP).toBe("false");
    expect(env.GF_AUTH_ANONYMOUS_ENABLED).toBe("false");
    expect(env.GF_ANALYTICS_REPORTING_ENABLED).toBe("false");
    expect(env.GF_ANALYTICS_CHECK_FOR_UPDATES).toBe("false");
  });

  it("every workload carries an `app` label and a policy selects it", () => {
    for (const w of workloads) {
      const label = w.spec.template.metadata.labels.app;
      expect(label).toBeTruthy();
      expect(policies.some((p) => p.spec.podSelector.matchLabels?.app === label)).toBe(true);
    }
  });
});

describe("network", () => {
  it("Prometheus is reached only by Grafana and reaches only the three metrics ports", () => {
    const p = policy("prometheus");
    expect(p.spec.ingress).toHaveLength(1);
    expect(apps(p.spec.ingress[0])).toEqual(["grafana"]);
    const egress = p.spec.egress.map((r: Doc) => [apps(r)[0], r.ports[0].port]);
    expect(egress.sort()).toEqual([["clickhouse", 9363], ["ingest", 3002], ["otel-collector", 8888]]);
    expect(JSON.stringify(p.spec.egress)).not.toContain("ipBlock"); // sin salida a Internet
  });

  it("Grafana has no ingress at all (it is opened with port-forward) and reaches only Prometheus", () => {
    const g = policy("grafana");
    expect(g.spec.ingress).toBeUndefined();
    expect(g.spec.policyTypes).toContain("Ingress");
    expect(g.spec.egress).toHaveLength(1);
    expect(apps(g.spec.egress[0])).toEqual(["prometheus"]);
  });

  it.each([
    ["scrape-ingest", "ingest", 3002],
    ["scrape-otel-collector", "otel-collector", 8888],
    ["scrape-clickhouse", "clickhouse", 9363],
  ])("%s lets only Prometheus in, on the metrics port only", (name, target, port) => {
    const p = policy(name);
    expect(p.spec.podSelector.matchLabels.app).toBe(target);
    expect(p.spec.policyTypes).toEqual(["Ingress"]);
    expect(p.spec.ingress).toHaveLength(1);
    expect(apps(p.spec.ingress[0])).toEqual(["prometheus"]);
    expect(p.spec.ingress[0].ports).toEqual([{ protocol: "TCP", port }]);
  });
});

describe("scrape configuration", () => {
  const config = parse(readFileSync(join(CONFIG, "prometheus.yml"), "utf8")) as Doc;

  it("discovers targets by DNS, never through the Kubernetes API", () => {
    expect(JSON.stringify(config)).not.toContain("kubernetes_sd_configs");
    const dns = config.scrape_configs.flatMap((j: Doc) => (j.dns_sd_configs ?? []).flatMap((d: Doc) => d.names));
    expect(dns.sort()).toEqual(["clickhouse-metrics", "ingest-metrics", "otel-collector-metrics"]);
  });

  it("each target is a headless Service, so every replica is measured and not one at random", () => {
    for (const name of ["ingest-metrics", "otel-collector-metrics", "clickhouse-metrics"]) {
      const svc = docs.find((d) => d.kind === "Service" && d.metadata.name === name)!;
      expect(svc.spec.clusterIP).toBe("None");
    }
  });
});

const alerts = parse(readFileSync(join(CONFIG, "alerts.yaml"), "utf8")) as Doc;
const rules: Doc[] = alerts.groups.flatMap((g: Doc) => g.rules);

describe("alert rules", () => {
  it("every rule has an expression, a duration, a severity and a summary", () => {
    expect(rules.length).toBeGreaterThan(5);
    for (const r of rules) {
      expect(r.alert, JSON.stringify(r)).toMatch(/^[A-Z][A-Za-z]+$/);
      expect(r.expr).toBeTruthy();
      expect(r.for).toMatch(/^\d+[smh]$/);
      expect(["critical", "warning"]).toContain(r.labels.severity);
      expect(r.annotations.summary).toBeTruthy();
    }
    expect(new Set(rules.map((r) => r.alert)).size).toBe(rules.length);
  });

  it("covers the failures the ADR cares about", () => {
    const names = rules.map((r) => r.alert);
    expect(names).toEqual(expect.arrayContaining(["TargetDown", "IngestNoInstances", "IngestHighErrorRate", "IngestIdentityStoreDown", "CollectorExportFailing", "CollectorQueueFilling"]));
  });
});

describe("metrics referenced by alerts and the dashboard exist", () => {
  const dashboardText = readFileSync(join(CONFIG, "pipeline.json"), "utf8");
  const server = readFileSync(join(ROOT, "api", "src", "ingest", "server.ts"), "utf8");
  const referenced = (text: string) => [...new Set([...text.matchAll(/\bmemtrace_ingest_[a-z_]+/g)].map((m) => m[0].replace(/_(bucket|sum|count)$/, "")))];

  it.each(referenced(readFileSync(join(CONFIG, "alerts.yaml"), "utf8") + dashboardText))("the ingest service defines %s", (metric) => {
    expect(server).toContain(`"${metric}"`);
  });

  it("only uses Collector metric names that the pinned Collector exposes (no _total suffix in 0.96)", () => {
    const text = readFileSync(join(CONFIG, "alerts.yaml"), "utf8") + dashboardText;
    const names = [...new Set([...text.matchAll(/\botelcol_[a-z_]+/g)].map((m) => m[0]))];
    expect(names.length).toBeGreaterThan(3);
    expect(names.filter((n) => n.endsWith("_total"))).toEqual([]);
  });
});

describe("dashboard", () => {
  const dash = JSON.parse(readFileSync(join(CONFIG, "pipeline.json"), "utf8")) as Doc;

  it("is provisioned with a stable uid, read-only, and every panel queries the provisioned datasource", () => {
    expect(dash.uid).toBe("memtrace-pipeline");
    expect(dash.editable).toBe(false);
    const ids = dash.panels.map((p: Doc) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of dash.panels) {
      expect(p.datasource.uid).toBe("prometheus");
      for (const t of p.targets) expect(t.expr).toBeTruthy();
    }
  });

  it("panels fit the 24-column grid without overlapping", () => {
    const boxes = dash.panels.map((p: Doc) => p.gridPos);
    for (const b of boxes) expect(b.x + b.w).toBeLessThanOrEqual(24);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `panels ${i} and ${j}`).toBe(false);
      }
    }
  });
});
