/**
 * Postura de red y de contenedores de los manifiestos (ADR-079). No sustituye probar el clúster real (`make netpol-check`),
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
const collectorConfig = () => {
  const cm = docs.find(({ doc }) => doc.kind === "ConfigMap" && doc.metadata.name === "otel-collector-config")!.doc;
  return parseAllDocuments(cm.data["otel-collector-config.yaml"])[0]!.toJS() as Doc;
};

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

  it("only the API reaches the Collector, only on 4318", () => {
    const collector = policy("otel-collector");
    expect(collector.spec.ingress).toEqual([{ from: [{ podSelector: { matchLabels: { app: "api" } } }], ports: [{ protocol: "TCP", port: 4318 }] }]);
    for (const p of policies) {
      for (const rule of p.spec.egress ?? []) {
        const targetsCollector = (rule.to ?? []).some((t: Doc) => t.podSelector?.matchLabels?.app === "otel-collector");
        if (targetsCollector) expect(["api"]).toContain(p.spec.podSelector.matchLabels?.app);
      }
    }
  });

  it("databases accept only the components that need them", () => {
    const from = (name: string) => policy(name).spec.ingress.flatMap((r: Doc) => r.from.flatMap((f: Doc) => f.podSelector?.matchLabels?.app ?? f.podSelector?.matchExpressions?.[0]?.values));
    expect(from("postgres")).not.toContain("otel-collector");
    expect(from("postgres")).not.toContain("dashboard");
    expect(from("clickhouse")).not.toContain("dashboard");
    expect(from("clickhouse")).not.toContain("docs");
  });

  it("the dashboard and the docs cannot reach the stores", () => {
    expect(policy("dashboard").spec.egress.map((r: Doc) => r.to[0].podSelector.matchLabels.app)).toEqual(["api"]);
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

  it("the gateway and the Collector read the token from the same secret", () => {
    const tokenRef = (app: string) => {
      const env = workloads.find((w) => w.app === app)!.template.spec.containers.flatMap((c: Doc) => c.env ?? []).find((e: Doc) => e.name === "INGEST_INTERNAL_TOKEN");
      return env?.valueFrom?.secretKeyRef;
    };
    expect(tokenRef("api")).toBeDefined();
    expect(tokenRef("api")).toEqual(tokenRef("otel-collector"));
  });
});

describe("containers", () => {
  const hardened = ["api", "dashboard", "docs", "otel-collector", "health-probe", "backfill-experiment-id"];
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

describe("ClickHouse users (ADR-079)", () => {
  const secret = docs.find(({ doc }) => doc.kind === "Secret" && doc.metadata.name === "clickhouse-credentials")!.doc;
  const envOf = (app: string) => workloads.find((w) => w.app === app)!.template.spec.containers.flatMap((c: Doc) => c.env ?? []) as Doc[];

  it("the API reads with a read-only user, not with the administrator", () => {
    const env = envOf("api");
    expect(env.find((e) => e.name === "CLICKHOUSE_USER")?.value).toBe("api_reader");
    expect(env.find((e) => e.name === "CLICKHOUSE_PASSWORD")?.valueFrom.secretKeyRef.key).toBe("reader-password");
    expect(Object.keys(secret.stringData)).toEqual(expect.arrayContaining(["reader-password", "collector-password", "writer-password"]));
  });

  it("the Collector writes with its own user", () => {
    const config = collectorConfig();
    expect(config.exporters.clickhouse.username).toBe("collector");
    expect(config.exporters.clickhouse.password).toBe("${env:COLLECTOR_CLICKHOUSE_PASSWORD}");
    expect(envOf("otel-collector").find((e) => e.name === "COLLECTOR_CLICKHOUSE_PASSWORD")?.valueFrom.secretKeyRef.key).toBe("collector-password");
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
