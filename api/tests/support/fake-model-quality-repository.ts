import type { ModelQualityRepository } from "@/application/ports/model-quality-repository";
import type { MatchDecision } from "@/domain/model-quality";

/** Las decisiones en memoria, con las mismas reglas que la tabla: una respuesta «positiva» por clave y por organización. */
export class FakeModelQualityRepository implements ModelQualityRepository {
  readonly rows: Array<MatchDecision & { organizationId: string; decidedBy: string }> = [];

  async listDecisions(organizationId: string): Promise<MatchDecision[]> {
    return this.rows.filter((r) => r.organizationId === organizationId).map(({ modelKey, arenaModelName, decision }) => ({ modelKey, arenaModelName, decision }));
  }

  private drop(organizationId: string, modelKey: string, keep: (r: MatchDecision) => boolean) {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i]!;
      if (r.organizationId === organizationId && r.modelKey === modelKey && !keep(r)) this.rows.splice(i, 1);
    }
  }

  async confirm(organizationId: string, modelKey: string, arenaModelName: string, userId: string) {
    this.drop(organizationId, modelKey, (r) => r.decision === "rejected" && r.arenaModelName !== arenaModelName);
    this.rows.push({ organizationId, modelKey, arenaModelName, decision: "confirmed", decidedBy: userId });
  }

  async reject(organizationId: string, modelKey: string, arenaModelNames: string[], userId: string) {
    for (const name of arenaModelNames) {
      if (!this.rows.some((r) => r.organizationId === organizationId && r.modelKey === modelKey && r.arenaModelName === name)) {
        this.rows.push({ organizationId, modelKey, arenaModelName: name, decision: "rejected", decidedBy: userId });
      }
    }
  }

  async setNoEquivalent(organizationId: string, modelKey: string, userId: string) {
    this.drop(organizationId, modelKey, (r) => r.decision === "rejected");
    this.rows.push({ organizationId, modelKey, arenaModelName: "", decision: "no_equivalent", decidedBy: userId });
  }

  async clear(organizationId: string, modelKey: string) {
    const before = this.rows.length;
    this.drop(organizationId, modelKey, () => false);
    return this.rows.length < before;
  }
}
