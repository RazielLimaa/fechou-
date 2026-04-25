import type {
  ClauseCatalog,
  ClauseRule,
  ContractContext,
  DecisionLog,
  EvidenceProfile,
  RuleAction,
  RuleCondition,
  ValidationIssue,
} from "./domain.js";
import type {
  ClauseIntensityLevel,
  EvidenceEventRequirement,
  EvidenceRecommendationPatch,
  FactsRecord,
  LegalReference,
  RuleFactValue,
} from "./types.js";

interface SelectedClauseState {
  clauseCode: string;
  intensity: ClauseIntensityLevel;
  reason: string;
  required: boolean;
  priority: number;
  sourceRuleId?: string;
}

export interface RuleExecutionState {
  facts: FactsRecord;
  selectedClauses: Map<string, SelectedClauseState>;
  excludedClauses: Set<string>;
  evidencePatch: EvidenceRecommendationPatch;
  emittedRisks: Array<{
    code: string;
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    description: string;
    mitigation: string;
    legalReferences: LegalReference[];
  }>;
  emittedIssues: ValidationIssue[];
  decisions: DecisionLog[];
  executedRuleIds: string[];
}

export interface RuleEngineInput {
  context: ContractContext;
  rules: ClauseRule[];
  catalog: ClauseCatalog[];
  baseEvidence: EvidenceProfile;
  baseFacts?: FactsRecord;
}

const INTENSITY_WEIGHT: Record<ClauseIntensityLevel, number> = {
  light: 1,
  medium: 2,
  strong: 3,
};

function nowIso() {
  return new Date().toISOString();
}

function decision(
  stage: DecisionLog["stage"],
  actionType: string,
  summary: string,
  rationale: string,
  evidence: Record<string, unknown>,
  legalReferences: LegalReference[],
  subjectType: string,
  subjectId?: string,
  ruleId?: string,
): DecisionLog {
  return {
    id: `decision.${stage}.${actionType}.${Math.random().toString(36).slice(2, 10)}`,
    stage,
    actionType,
    subjectType,
    subjectId,
    ruleId,
    summary,
    rationale,
    evidence,
    legalReferences,
    happenedAt: nowIso(),
  };
}

function mergeEvents(base?: EvidenceEventRequirement[], next?: EvidenceEventRequirement[]) {
  const map = new Map<string, EvidenceEventRequirement>();
  for (const event of base ?? []) map.set(event.code, event);
  for (const event of next ?? []) {
    const current = map.get(event.code);
    map.set(event.code, current ? { ...current, ...event, required: current.required || event.required } : event);
  }
  return map.size ? Array.from(map.values()) : undefined;
}

function mergeEvidencePatch(current: EvidenceRecommendationPatch, next: EvidenceRecommendationPatch): EvidenceRecommendationPatch {
  return {
    recommendedSignature: next.recommendedSignature ?? current.recommendedSignature,
    witnesses: next.witnesses ?? current.witnesses,
    executiveTitleReadiness: next.executiveTitleReadiness ?? current.executiveTitleReadiness,
    requiredEvents: mergeEvents(current.requiredEvents, next.requiredEvents),
    addNotes: Array.from(new Set([...(current.addNotes ?? []), ...(next.addNotes ?? [])])),
  };
}

function asNumber(value: RuleFactValue | RuleFactValue[] | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function evaluateFact(actual: RuleFactValue, condition: Extract<RuleCondition, { kind: "fact" }>) {
  const expected = condition.value;
  switch (condition.operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return (asNumber(actual) ?? Number.NEGATIVE_INFINITY) > (asNumber(expected) ?? Number.POSITIVE_INFINITY);
    case "gte":
      return (asNumber(actual) ?? Number.NEGATIVE_INFINITY) >= (asNumber(expected) ?? Number.POSITIVE_INFINITY);
    case "lt":
      return (asNumber(actual) ?? Number.POSITIVE_INFINITY) < (asNumber(expected) ?? Number.NEGATIVE_INFINITY);
    case "lte":
      return (asNumber(actual) ?? Number.POSITIVE_INFINITY) <= (asNumber(expected) ?? Number.NEGATIVE_INFINITY);
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "contains":
      return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "truthy":
      return Boolean(actual);
    case "falsy":
      return !actual;
    default:
      return false;
  }
}

export function evaluateRuleCondition(condition: RuleCondition, facts: FactsRecord): boolean {
  switch (condition.kind) {
    case "all":
      return condition.conditions.every((item) => evaluateRuleCondition(item, facts));
    case "any":
      return condition.conditions.some((item) => evaluateRuleCondition(item, facts));
    case "not":
      return !evaluateRuleCondition(condition.condition, facts);
    case "fact":
      return evaluateFact(facts[condition.fact] ?? null, condition);
    default:
      return false;
  }
}

function pickIntensity(current: SelectedClauseState | undefined, next: ClauseIntensityLevel | undefined, fallback: ClauseCatalog | undefined) {
  const candidate = next ?? fallback?.defaultIntensity ?? "medium";
  if (!current) return candidate;
  return INTENSITY_WEIGHT[candidate] > INTENSITY_WEIGHT[current.intensity] ? candidate : current.intensity;
}

function toValidationIssue(action: Extract<RuleAction, { type: "raise_issue" }>): ValidationIssue {
  return {
    code: action.issue.code,
    severity: action.issue.severity,
    category: action.issue.category,
    impact: action.issue.impact,
    message: action.issue.message,
    userMessage: action.issue.userMessage,
    recommendation: action.issue.recommendation,
    legalReferences: action.issue.legalReferences ?? [],
    clauseCodes: action.issue.clauseCodes ?? [],
    blocking: Boolean(action.issue.blocking),
  };
}

function applyAction(action: RuleAction, rule: ClauseRule, state: RuleExecutionState, catalogByCode: Map<string, ClauseCatalog>) {
  if (action.type === "select_clause") {
    if (state.excludedClauses.has(action.clauseCode)) {
      state.decisions.push(
        decision(rule.stage, "clause_selection_skipped", `Clausula ${action.clauseCode} ignorada.`, action.reason, { clauseCode: action.clauseCode }, rule.legalReferences, "clause", action.clauseCode, rule.id),
      );
      return;
    }
    const current = state.selectedClauses.get(action.clauseCode);
    const intensity = pickIntensity(current, action.intensity, catalogByCode.get(action.clauseCode));
    state.selectedClauses.set(action.clauseCode, {
      clauseCode: action.clauseCode,
      intensity,
      reason: current ? `${current.reason}; ${action.reason}` : action.reason,
      required: current?.required || Boolean(action.required),
      priority: current ? Math.max(current.priority, rule.priority) : rule.priority,
      sourceRuleId: rule.id,
    });
    state.decisions.push(
      decision(rule.stage, "clause_selected", `Clausula ${action.clauseCode} selecionada em intensidade ${intensity}.`, action.reason, { clauseCode: action.clauseCode, intensity }, rule.legalReferences, "clause", action.clauseCode, rule.id),
    );
    return;
  }

  if (action.type === "exclude_clause") {
    state.excludedClauses.add(action.clauseCode);
    state.selectedClauses.delete(action.clauseCode);
    state.decisions.push(
      decision(rule.stage, "clause_excluded", `Clausula ${action.clauseCode} excluida.`, action.reason, { clauseCode: action.clauseCode }, rule.legalReferences, "clause", action.clauseCode, rule.id),
    );
    return;
  }

  if (action.type === "raise_risk") {
    state.emittedRisks.push({ ...action.risk, legalReferences: action.legalReferences ?? rule.legalReferences });
    state.decisions.push(
      decision(rule.stage, "risk_raised", `Risco ${action.risk.code} adicionado.`, action.risk.description, { riskCode: action.risk.code }, action.legalReferences ?? rule.legalReferences, "risk", action.risk.code, rule.id),
    );
    return;
  }

  if (action.type === "raise_issue") {
    const issue = toValidationIssue(action);
    state.emittedIssues.push(issue);
    state.decisions.push(
      decision(rule.stage, "validation_seeded", `Issue ${issue.code} semeado.`, issue.message, { issueCode: issue.code }, issue.legalReferences, "validation_issue", issue.code, rule.id),
    );
    return;
  }

  if (action.type === "set_evidence") {
    state.evidencePatch = mergeEvidencePatch(state.evidencePatch, action.patch);
    state.decisions.push(
      decision(rule.stage, "evidence_patched", "Perfil probatorio ajustado.", action.reason, { patch: action.patch }, rule.legalReferences, "evidence_profile", "runtime", rule.id),
    );
    return;
  }

  state.facts[action.fact] = action.value;
  state.decisions.push(
    decision(rule.stage, "fact_set", `Fato ${action.fact} ajustado.`, action.reason, { fact: action.fact, value: action.value }, rule.legalReferences, "fact", action.fact, rule.id),
  );
}

export class RuleEngine {
  execute(input: RuleEngineInput): { state: RuleExecutionState } {
    const catalogByCode = new Map(input.catalog.map((item) => [item.code, item]));
    const rules = [...input.rules].filter((item) => item.active).sort((a, b) => b.priority - a.priority);
    const selectedClauses = new Map<string, SelectedClauseState>();

    for (const clause of input.catalog) {
      const byKind = clause.appliesToKinds[0] === "any" || clause.appliesToKinds.includes(input.context.contractKind);
      const byRelationship =
        clause.appliesToRelationships[0] === "any" || clause.appliesToRelationships.includes(input.context.relationshipKind);
      if (clause.baseRequired && byKind && byRelationship) {
        selectedClauses.set(clause.code, {
          clauseCode: clause.code,
          intensity: clause.defaultIntensity,
          reason: "Clausula base obrigatoria do modelo.",
          required: true,
          priority: Number.MAX_SAFE_INTEGER,
        });
      }
    }

    const state: RuleExecutionState = {
      facts: { ...input.context.facts, ...(input.baseFacts ?? {}) },
      selectedClauses,
      excludedClauses: new Set<string>(),
      evidencePatch: {
        recommendedSignature: input.baseEvidence.recommendedSignature,
        witnesses: input.baseEvidence.witnesses,
        executiveTitleReadiness: input.baseEvidence.executiveTitleReadiness,
        requiredEvents: input.baseEvidence.requiredEvents,
        addNotes: input.baseEvidence.notes,
      },
      emittedRisks: [],
      emittedIssues: [],
      decisions: [],
      executedRuleIds: [],
    };

    for (const rule of rules) {
      const dependencyBlocked = rule.dependsOnRuleIds?.some((id) => !state.executedRuleIds.includes(id));
      if (dependencyBlocked) continue;

      const matched = evaluateRuleCondition(rule.when, state.facts);
      const actions = matched ? rule.actions : rule.fallbackActions ?? [];
      if (!matched && actions.length === 0) {
        state.decisions.push(
          decision(rule.stage, "rule_not_matched", `Regra ${rule.code} nao disparou.`, rule.rationale, { ruleId: rule.id }, rule.legalReferences, "rule", rule.id, rule.id),
        );
        continue;
      }

      for (const action of actions) {
        applyAction(action, rule, state, catalogByCode);
      }
      state.executedRuleIds.push(rule.id);
    }

    return { state };
  }
}
