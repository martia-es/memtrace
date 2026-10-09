import type { ApprovalRepository } from "@/application/ports/approval-repository";
import { mergeRules, type ApprovalAction, type ApprovalRule } from "@/domain/approval";

/** Lo que `PromptService` necesita saber de las reglas: qué exige una acción en un prompt, o null si nada (ADR-076). */
export interface ApprovalRulesPort {
  effectiveRule(prompt: { organizationId: string; experimentIds: string[] }, action: ApprovalAction, stage: string): Promise<ApprovalRule | null>;
}

/**
 * La regla efectiva de una acción sobre un prompt: la de su organización apilada con las de todos sus agentes. Apilar solo
 * endurece (el mayor mínimo por perfil, la unión de aprobadores), así que un experimento nunca afloja a la organización.
 */
export class ApprovalRuleResolver implements ApprovalRulesPort {
  constructor(private readonly repo: Pick<ApprovalRepository, "rulesFor">) {}

  async effectiveRule(prompt: { organizationId: string; experimentIds: string[] }, action: ApprovalAction, stage: string): Promise<ApprovalRule | null> {
    return mergeRules(await this.repo.rulesFor(prompt.organizationId, prompt.experimentIds, action, stage));
  }
}
