import type { ContractClause, ContractContext, ContractScore, DecisionLog, EvidenceProfile, ValidationIssue } from "./domain.js";

function has(clauses: ContractClause[], code: string) {
  return clauses.some((item) => item.clauseCode === code);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function grade(total: number): ContractScore["grade"] {
  if (total >= 90) return "A";
  if (total >= 80) return "B";
  if (total >= 70) return "C";
  if (total >= 60) return "D";
  return "E";
}

export class ScoreEngine {
  score(
    context: ContractContext,
    clauses: ContractClause[],
    issues: ValidationIssue[],
    evidenceProfile: EvidenceProfile,
  ): { score: ContractScore; decisions: DecisionLog[] } {
    const blockers = issues.filter((item) => item.blocking).length;
    const errors = issues.filter((item) => item.severity === "error").length;
    const warnings = issues.filter((item) => item.severity === "warning").length;

    const legalCoverage = clamp(100 - blockers * 30 - errors * 15 - warnings * 5);
    const financialProtection = clamp(
      (has(clauses, "payment_terms") ? 35 : 0) +
        (has(clauses, "default_interest") ? 15 : 0) +
        (has(clauses, "penalty_clause") ? 20 : 0) +
        (has(clauses, "collateral_guarantee") ? 20 : 0) +
        (has(clauses, "price_adjustment") || !context.recurringBilling ? 10 : 0),
    );
    const clarity = clamp(
      (has(clauses, "object_scope") ? 30 : 0) +
        (has(clauses, "term_duration") ? 15 : 0) +
        (has(clauses, "deliverables_acceptance") || !context.hasDeliverables ? 20 : 0) +
        (has(clauses, "annex_matrix") ? 15 : 0) +
        20 -
        issues.filter((item) => item.category === "consistency").length * 10,
    );
    const signaturePoints = evidenceProfile.recommendedSignature === "qualified" ? 30 : evidenceProfile.recommendedSignature === "advanced" ? 20 : 10;
    const evidence = clamp(
      20 +
        signaturePoints +
        evidenceProfile.requiredEvents.length * 5 +
        (evidenceProfile.captureDocumentHash ? 10 : 0) +
        (evidenceProfile.captureAcceptanceRecord ? 10 : 0) +
        (evidenceProfile.witnesses !== "not_needed" ? 10 : 0),
    );
    const legalBalance = clamp(
      100 -
        issues.filter((item) => item.category === "consumer" || item.category === "arbitration").length * 18 -
        (context.consumerContext && has(clauses, "liability_cap_b2b") ? 35 : 0),
    );

    const dimensions = { legalCoverage, financialProtection, clarity, evidence, legalBalance };
    const total = clamp(
      dimensions.legalCoverage * 0.3 +
        dimensions.financialProtection * 0.2 +
        dimensions.clarity * 0.15 +
        dimensions.evidence * 0.2 +
        dimensions.legalBalance * 0.15,
    );

    const penalties = issues.map((issue) => ({
      code: issue.code,
      points: issue.blocking ? 30 : issue.severity === "error" ? 15 : issue.severity === "warning" ? 5 : 1,
      reason: issue.userMessage,
    }));

    const score: ContractScore = { total, grade: grade(total), dimensions, penalties };

    return {
      score,
      decisions: [
        {
          id: `decision.score.${Math.random().toString(36).slice(2, 10)}`,
          stage: "score",
          actionType: "score_calculated",
          subjectType: "contract_score",
          summary: `Score ${score.total} (${score.grade}).`,
          rationale: "Score pondera cobertura legal, protecao financeira, clareza, prova e equilibrio.",
          evidence: { dimensions, penalties: penalties.map((item) => item.code) },
          legalReferences: [],
          happenedAt: new Date().toISOString(),
        },
      ],
    };
  }
}
