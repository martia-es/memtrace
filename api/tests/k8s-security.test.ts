/**
 * Postura de red y de contenedores de los manifiestos (ADR-090). No sustituye probar el clúster real (`make netpol-check`),
 * pero impide que un cambio abra sin querer un camino al Collector o a los almacenes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";

const DIR = join(__dirname, "..", "..", "k8s");
type Doc = Record<string, any>;

const docs: Array<{ file: string; doc: Doc }> = readdirSync(DIR)
  .filter((f) => f.endsWith(".yaml"))
  .flatMap((file) => parseAllDocuments(readFileSync(join(DIR, file), "utf8")).map((d) => ({ file, doc: d.toJS() as Doc })))
  .filter(({ doc }) => doc && typeof doc === "object");

const podTemplate = (doc: Doc): Doc | undefined =>
  doc.kind === "CronJob" ? doc.spec?.jobTemplate?.spec?.template : ["Deployment", "StatefulSet", "Job"].includes(doc.kind) ? doc.spec?.template : undefined;
const workloads = docs.flatMap(({ file, doc }) => {
  const template = podTemplate(doc);
  return template ? [{ file, name: doc.metadata.name as string, app: template.metadata?.labels?.app as string | undefined, template }] : [];
});
const policies = docs.filter(({ doc }) => doc.kind === "NetworkPolicy").map(({ doc }) => doc);
const policy = (name: string) => policies.find((p) => p.metadata.name === name)!;
const configMapYaml = (name: string, key: string) => {
  const cm = docs.find(({ doc }) => doc.kind === "ConfigMap" && doc.metadata.name === name)!.doc;
  return parseAllDocuments(cm.data[key])[0]!.toJS() as Doc;
};
/** Collector de entrada: recibe de `ingest`, enmascara PII y publica en Kafka (ADR-098). */
const collectorConfig = () => configMapYaml("otel-collector-config", "otel-collector-config.yaml");
/** Collector de escritura: lee de Kafka y escribe en ClickHouse. */
const writerConfig = () => configMapYaml("otel-collector-writer-config", "otel-collector-writer-config.yaml");

describe("network policies", () => {
  it("denies all ingress and egress by default", () => {
    const deny = policy("default-deny-all");
    expect(deny.spec.podSelector).toEqual({});
    expect(deny.spec.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(deny.spec.ingress ?? deny.spec.egress).toBeUndefined();
  });

  it("every workload pod carries an `app` label (policies select by it)", () => {
    expect(workloads.filter((w) => !w.app).map((w) => w.name)).toEqual([]);
  });

  it("every workload is covered by at least one allow policy", () => {
    const selected = (app: string) =>
      policies.some((p) => {
        if (p.metadata.name === "default-deny-all" || p.metadata.name === "allow-dns") return false;
        const sel = p.spec.podSelector;
        if (sel.matchLabels?.app === app) return true;
        return (sel.matchExpressions ?? []).some((e: Doc) => e.key === "app" && e.operator === "In" && e.values.includes(app));
      });
    expect(workloads.filter((w) => w.app && !selected(w.app)).map((w) => w.name)).toEqual([]);
  });

  it("only the ingest service reaches the Collector, only on 4318 (ADR-098)", () => {
    const collector = policy("otel-collector");
    expect(collector.spec.ingress).toEqual([{ from: [{ podSelector: { matchLabels: { app: "ingest" } } }], ports: [{ protocol: "TCP", port: 4318 }] }]);
    for (const p of policies) {
      for (const rule of p.spec.egress ?? []) {
        const targetsCollector = (rule.to ?? []).some((t: Doc) => t.podSelector?.matchLabels?.app === "otel-collector");
        if (targetsCollector) expect(["ingest"]).toContain(p.spec.podSelector.matchLabels?.app);
      }
    }
  });

  it("the ingest service talks only to Postgres and the Collector: no ClickHouse, no Internet", () => {
    const targets = policy("ingest").spec.egress.flatMap((r: Doc) => r.to.map((t: Doc) => t.podSelector?.matchLabels?.app ?? `ipBlock:${t.ipBlock?.cidr}`));
    expect(targets.sort()).toEqual(["otel-collector", "postgres"]);
  });

  it("the ingest service is reached only by the dashboard proxy and the ingress controller, on 3002", () => {
    const rule = policy("ingest").spec.ingress;
    expect(rule).toHaveLength(1);
    expect(rule[0].ports).toEqual([{ protocol: "TCP", port: 3002 }]);
    expect(rule[0].from.map((f: Doc) => f.podSelector?.matchLabels?.app ?? f.namespaceSelector?.matchLabels?.["kubernetes.io/metadata.name"])).toEqual(["dashboard", "ingress-nginx"]);
  });

  it("databases accept only the components that need them", () => {
    const from = (name: string) => policy(name).spec.ingress.flatMap((r: Doc) => r.from.flatMap((f: Doc) => f.podSelector?.matchLabels?.app ?? f.podSelector?.matchExpressions?.[0]?.values));
    expect(from("postgres")).not.toContain("otel-collector");
    expect(from("postgres")).not.toContain("dashboard");
    expect(from("clickhouse")).not.toContain("dashboard");
    expect(from("clickhouse")).not.toContain("docs");
  });

  it("the dashboard and the docs cannot reach the stores", () => {
    expect(policy("dashboard").spec.egress.map((r: Doc) => r.to[0].podSelector.matchLabels.app)).toEqual(["api", "ingest"]);
    expect(policy("docs").spec.policyTypes).toEqual(["Ingress"]);
  });

  it("Internet egress never includes the cluster's own networks", () => {
    for (const p of policies) {
      for (const rule of p.spec.egress ?? []) {
        for (const to of rule.to ?? []) if (to.ipBlock?.cidr === "0.0.0.0/0") expect(to.ipBlock.except?.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("Collector", () => {
  it("accepts OTLP over HTTP only, behind a bearer token", () => {
    const config = collectorConfig();
    expect(Object.keys(config.receivers.otlp.protocols)).toEqual(["http"]);
    expect(config.receivers.otlp.protocols.http.auth).toEqual({ authenticator: "bearertokenauth" });
    expect(config.extensions.bearertokenauth.token).toBe("${env:INGEST_INTERNAL_TOKEN}");
    expect(config.service.extensions).toContain("bearertokenauth");
  });

  it("exposes no gRPC port, neither in the pod nor in the service", () => {
    const portsOf = JSON.stringify(docs.filter(({ file }) => file === "40-otel-collector.yaml").map(({ doc }) => doc.spec));
    expect(portsOf).not.toContain("4317");
    expect(JSON.stringify(docs.map(({ doc }) => doc.spec?.ports ?? []))).not.toContain("4317");
  });

  it("the ingest service and the Collector read the token from the same secret, and the API does not hold it", () => {
    const tokenRef = (app: string) => {
      const env = workloads.find((w) => w.app === app)!.template.spec.containers.flatMap((c: Doc) => c.env ?? []).find((e: Doc) => e.name === "INGEST_INTERNAL_TOKEN");
      return env?.valueFrom?.secretKeyRef;
    };
    expect(tokenRef("ingest")).toBeDefined();
    expect(tokenRef("ingest")).toEqual(tokenRef("otel-collector"));
    expect(tokenRef("api")).toBeUndefined();
  });
});

describe("containers", () => {
  const hardened = ["api", "ingest", "kafka", "otel-collector-writer", "dashboard", "docs", "otel-collector", "health-probe", "backfill-experiment-id", "dedupe-otel-traces", "maintain-otel-traces"];
  it.each(hardened)("%s drops privileges and runs as non-root", (app) => {
    const { template } = workloads.find((w) => w.app === app)!;
    const nonRoot = template.spec.securityContext?.runAsNonRoot === true || template.spec.containers.every((c: Doc) => c.securityContext?.runAsNonRoot === true);
    expect(nonRoot).toBe(true);
    for (const c of template.spec.containers) {
      expect(c.securityContext?.allowPrivilegeEscalation).toBe(false);
      expect(c.securityContext?.capabilities?.drop).toEqual(["ALL"]);
    }
  });
});

describe("the pipeline between the Collectors (ADR-098)", () => {
  const targets = (name: string, direction: "egress" | "ingress") =>
    policy(name).spec[direction].flatMap((r: Doc) => (r.to ?? r.from).map((t: Doc) => `${t.podSelector?.matchLabels?.app ?? t.podSelector?.matchExpressions?.[0]?.values.join("+")}:${r.ports.map((p: Doc) => p.port).join("/")}`));

  it("the entry Collector reaches only Kafka, never ClickHouse", () => {
    expect(targets("otel-collector", "egress")).toEqual(["kafka:9092"]);
  });

  it("only the writer reaches ClickHouse among the Collectors", () => {
    expect(targets("otel-collector-writer", "egress").sort()).toEqual(["clickhouse:9000", "kafka:9092"]);
    const nativePort = policy("clickhouse").spec.ingress.find((r: Doc) => r.ports.some((p: Doc) => p.port === 9000 && r.from[0].podSelector.matchLabels));
    expect(nativePort.from[0].podSelector.matchLabels.app).toBe("otel-collector-writer");
    expect(workloads.find((w) => w.app === "otel-collector-writer")).toBeDefined();
  });

  it("the writer is not reachable by anyone (its metrics are read through the monitoring policies)", () => {
    expect(policy("otel-collector-writer").spec.ingress).toBeUndefined();
  });

  it("Kafka accepts the Collectors and the topic job on 9092, and its own nodes on 9092 and 9093", () => {
    expect(targets("kafka", "ingress")).toEqual(["otel-collector+otel-collector-writer+kafka-topics:9092", "kafka:9092/9093"]);
    expect(targets("kafka", "egress")).toEqual(["kafka:9092/9093"]);
  });

  it("the entry Collector publishes with acks=all and without a queue of its own, so an error reaches ingest", () => {
    const kafka = collectorConfig().exporters.kafka;
    expect(kafka.producer.required_acks).toBe(-1);
    expect(kafka.sending_queue.enabled).toBe(false);
    expect(kafka.retry_on_failure.enabled).toBe(false);
    expect(collectorConfig().service.pipelines.traces.exporters).toEqual(["kafka"]);
    expect(collectorConfig().service.pipelines.traces.processors).not.toContain("batch");
  });

  it("the writer inserts synchronously: no batch processor, no queue, and ClickHouse answers only once it has written", () => {
    const config = writerConfig();
    expect(config.service.pipelines.traces.processors).toBeUndefined();
    expect(config.exporters.clickhouse.sending_queue.enabled).toBe(false);
    expect(config.exporters.clickhouse.connection_params.wait_for_async_insert).toBe("1");
    expect(config.receivers.kafka.group_id).toBe("clickhouse-writers");
    expect(config.receivers.kafka.topic).toBe(collectorConfig().exporters.kafka.topic);
  });

  it("does not set protocol_version, which some brokers reject", () => {
    expect(JSON.stringify([collectorConfig(), writerConfig()])).not.toContain("protocol_version");
  });
});

describe("the ingest service holds only what it needs (ADR-098)", () => {
  const env = () => workloads.find((w) => w.app === "ingest")!.template.spec.containers.flatMap((c: Doc) => c.env ?? []) as Doc[];

  it("has no ClickHouse or login credentials", () => {
    const names = env().map((e) => e.name);
    expect(names.filter((n) => /^(CLICKHOUSE|AUTH_|GOOGLE_|MICROSOFT_|RESEND|GITHUB_)/.test(n))).toEqual([]);
  });

  it("reports ready and alive without depending on Postgres or the Collector, and has a read-only filesystem", () => {
    const container = workloads.find((w) => w.app === "ingest")!.template.spec.containers[0];
    expect(container.readinessProbe.httpGet.path).toBe("/ready");
    expect(container.livenessProbe.httpGet.path).toBe("/health");
    expect(container.securityContext.readOnlyRootFilesystem).toBe(true);
  });
});

describe("ClickHouse users (ADR-090)", () => {
  const secret = docs.find(({ doc }) => doc.kind === "Secret" && doc.metadata.name === "clickhouse-credentials")!.doc;
  const envOf = (app: string) => workloads.find((w) => w.app === app)!.template.spec.containers.flatMap((c: Doc) => c.env ?? []) as Doc[];

  it("the API reads with a read-only user, not with the administrator", () => {
    const env = envOf("api");
    expect(env.find((e) => e.name === "CLICKHOUSE_USER")?.value).toBe("api_reader");
    expect(env.find((e) => e.name === "CLICKHOUSE_PASSWORD")?.valueFrom.secretKeyRef.key).toBe("reader-password");
    expect(Object.keys(secret.stringData)).toEqual(expect.arrayContaining(["reader-password", "collector-password", "writer-password"]));
  });

  it("the Collector writer writes with its own user, and the entry Collector has no ClickHouse credentials", () => {
    const config = writerConfig();
    expect(config.exporters.clickhouse.username).toBe("collector");
    expect(config.exporters.clickhouse.password).toBe("${env:COLLECTOR_CLICKHOUSE_PASSWORD}");
    expect(envOf("otel-collector-writer").find((e) => e.name === "COLLECTOR_CLICKHOUSE_PASSWORD")?.valueFrom.secretKeyRef.key).toBe("collector-password");
    expect(envOf("otel-collector").map((e) => e.name).filter((n) => /CLICKHOUSE/.test(n))).toEqual([]);
    expect(JSON.stringify(collectorConfig())).not.toMatch(/clickhouse/i);
  });

  it("the migration job creates the users with only the grants they need", () => {
    const job = docs.find(({ doc }) => doc.kind === "Job" && doc.metadata.name === "clickhouse-migrate")!.doc;
    const script: string = job.spec.template.spec.containers[0].args[0];
    expect(script).toContain("GRANT SELECT ON memtrace.* TO api_reader");
    expect(script).toMatch(/CREATE USER IF NOT EXISTS api_reader[^\n]*SETTINGS readonly = 2/);
    expect(script).toContain("GRANT INSERT, CREATE TABLE ON memtrace.otel_traces TO collector");
    expect(script).not.toMatch(/GRANT (ALL|SELECT ON memtrace\.\*|ALTER|DROP)[^\n]* TO collector/);
    expect(script).not.toMatch(/GRANT (ALL|INSERT|ALTER|DROP)[^\n]* ON memtrace\.\*[^\n]* TO api_reader/);
  });
});
