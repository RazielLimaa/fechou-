import type {
  ClauseCatalog,
  ClauseDependency,
  ClauseRule,
  ClauseVariant,
  ContractClause,
  ContractContext,
  ContractGraph,
  DecisionLog,
  EvidenceProfile,
  RiskItem,
  ValidationIssue,
} from "./domain.js";
import type { ClauseIntensityLevel, EvidenceRecommendationPatch } from "./types.js";
import { buildContractGraph } from "./contract-graph.js";
import { evaluateRuleCondition, RuleEngine } from "./rule-engine.js";

interface ClauseSelectionState {
  clauseCode: string;
  intensity: ClauseIntensityLevel;
  reason: string;
  required: boolean;
  dependencySource: string[];
}

export interface ClauseCompositionResult {
  clauses: ContractClause[];
  graph: ContractGraph;
  risks: RiskItem[];
  seededIssues: ValidationIssue[];
  evidenceProfile: EvidenceProfile;
  decisions: DecisionLog[];
}

const INTENSITY_ORDER: Record<ClauseIntensityLevel, number> = {
  light: 1,
  medium: 2,
  strong: 3,
};

const NODE_ORDER: Record<ContractClause["node"], number> = {
  core: 1,
  financial: 2,
  execution: 3,
  risk: 4,
  legal: 5,
  disputes: 6,
  annexes: 7,
};

function nowIso() {
  return new Date().toISOString();
}

function decision(summary: string, rationale: string, evidence: Record<string, unknown>, subjectId?: string): DecisionLog {
  return {
    id: `decision.dependency.${Math.random().toString(36).slice(2, 10)}`,
    stage: "dependency",
    actionType: "dependency_resolved",
    subjectType: "clause",
    subjectId,
    summary,
    rationale,
    evidence,
    legalReferences: [],
    happenedAt: nowIso(),
  };
}

function pickIntensity(current: ClauseSelectionState | undefined, next: ClauseIntensityLevel | undefined, fallback: ClauseIntensityLevel) {
  const candidate = next ?? fallback;
  if (!current) return candidate;
  return INTENSITY_ORDER[candidate] > INTENSITY_ORDER[current.intensity] ? candidate : current.intensity;
}

function matchesCatalog(clause: ClauseCatalog, context: ContractContext) {
  const byKind = clause.appliesToKinds[0] === "any" || clause.appliesToKinds.includes(context.contractKind);
  const byRelationship = clause.appliesToRelationships[0] === "any" || clause.appliesToRelationships.includes(context.relationshipKind);
  return byKind && byRelationship;
}

function selectVariant(clauseCode: string, intensity: ClauseIntensityLevel, variantsByClause: Map<string, ClauseVariant[]>) {
  const variants = variantsByClause.get(clauseCode) ?? [];
  const exact = variants.find((item) => item.intensity === intensity);
  const medium = variants.find((item) => item.intensity === "medium");
  const fallback = exact ?? medium ?? variants[0];
  if (!fallback) throw new Error(`Nenhuma variante cadastrada para a clausula ${clauseCode}.`);
  return fallback;
}

export class ClauseCompositionEngine {
  private readonly ruleEngine = new RuleEngine();

  compose(
    context: ContractContext,
    catalog: ClauseCatalog[],
    variants: ClauseVariant[],
    dependencies: ClauseDependency[],
    rules: ClauseRule[],
    baseEvidenceProfile: EvidenceProfile,
    applyEvidencePatch: (base: EvidenceProfile, patch: EvidenceRecommendationPatch) => EvidenceProfile,
  ): ClauseCompositionResult {
    const applicableCatalog = catalog.filter((item) => item.active && matchesCatalog(item, context));
    const catalogByCode = new Map(applicableCatalog.map((item) => [item.code, item]));
    const variantsByClause = new Map<string, ClauseVariant[]>();

    for (const variant of variants.filter((item) => item.active)) {
      const list = variantsByClause.get(variant.clauseCode) ?? [];
      list.push(variant);
      variantsByClause.set(variant.clauseCode, list);
    }

    const execution = this.ruleEngine.execute({ context, rules, catalog: applicableCatalog, baseEvidence: baseEvidenceProfile });
    const selected = new Map<string, ClauseSelectionState>();

    for (const [clauseCode, state] of execution.state.selectedClauses.entries()) {
      selected.set(clauseCode, {
        clauseCode,
        intensity: state.intensity,
        reason: state.reason,
        required: state.required,
        dependencySource: [],
      });
    }

    const dependencyDecisions: DecisionLog[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const dependency of dependencies) {
        const source = selected.get(dependency.fromClauseCode);
        if (!source) continue;
        if (dependency.condition && !evaluateRuleCondition(dependency.condition, context.facts)) continue;

        const targetCatalog = catalogByCode.get(dependency.toClauseCode);
        if (!targetCatalog) continue;

        if (dependency.kind === "conflicts_with" && selected.has(dependency.toClauseCode)) {
          selected.delete(dependency.toClauseCode);
          dependencyDecisions.push(
            decision(
              `Clausula ${dependency.toClauseCode} removida por conflito.`,
              dependency.rationale,
              { from: dependency.fromClauseCode, to: dependency.toClauseCode, kind: dependency.kind },
              dependency.toClauseCode,
            ),
          );
          changed = true;
          continue;
        }

        if (dependency.kind !== "requires" && dependency.kind !== "reinforces" && dependency.kind !== "fallback_to") continue;

        const current = selected.get(dependency.toClauseCode);
        const nextIntensity = pickIntensity(current, source.intensity, targetCatalog.defaultIntensity);
        if (!current) {
          selected.set(dependency.toClauseCode, {
            clauseCode: dependency.toClauseCode,
            intensity: nextIntensity,
            reason: `Incluida por dependencia de ${dependency.fromClauseCode}.`,
            required: dependency.kind === "requires",
            dependencySource: [dependency.fromClauseCode],
          });
          dependencyDecisions.push(
            decision(
              `Clausula ${dependency.toClauseCode} adicionada por dependencia.`,
              dependency.rationale,
              { from: dependency.fromClauseCode, to: dependency.toClauseCode, kind: dependency.kind },
              dependency.toClauseCode,
            ),
          );
          changed = true;
        } else if (!current.dependencySource.includes(dependency.fromClauseCode)) {
          current.dependencySource.push(dependency.fromClauseCode);
          current.intensity = nextIntensity;
        }
      }
    }

    const clauses = Array.from(selected.values())
      .map((state) => {
        const catalogEntry = catalogByCode.get(state.clauseCode);
        if (!catalogEntry) throw new Error(`Catalogo nao encontrado para ${state.clauseCode}.`);
        const variant = selectVariant(state.clauseCode, state.intensity, variantsByClause);
        return {
          clauseCode: state.clauseCode,
          variantId: variant.id,
          title: catalogEntry.title,
          node: catalogEntry.node,
          position: 0,
          status: state.dependencySource.length > 0 ? "derived" : "selected",
          style: {
            intensity: variant.intensity,
            rigidity: variant.rigidity,
            language: variant.language,
          },
          reason: state.reason,
          required: state.required,
          dependencySource: state.dependencySource,
          legalReferences: variant.legalReferences,
        } satisfies ContractClause;
      })
      .sort((left, right) => {
        const nodeDiff = NODE_ORDER[left.node] - NODE_ORDER[right.node];
        if (nodeDiff !== 0) return nodeDiff;
        const leftOrder = catalogByCode.get(left.clauseCode)?.sortOrder ?? 0;
        const rightOrder = catalogByCode.get(right.clauseCode)?.sortOrder ?? 0;
        return leftOrder - rightOrder;
      })
      .map((item, index) => ({ ...item, position: index + 1 }));

    const graph = buildContractGraph(context, clauses, applicableCatalog, dependencies);
    const evidenceProfile = applyEvidencePatch(baseEvidenceProfile, execution.state.evidencePatch);
    const risks: RiskItem[] = execution.state.emittedRisks.map((risk) => ({ ...risk, source: "rule" }));

    return {
      clauses,
      graph,
      risks,
      seededIssues: execution.state.emittedIssues,
      evidenceProfile,
      decisions: [...execution.state.decisions, ...dependencyDecisions],
    };
  }
}
