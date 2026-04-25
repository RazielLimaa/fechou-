import type { ClauseCatalog, ClauseDependency, ContractClause, ContractContext, ContractGraph, ContractGraphNode } from "./domain.js";
import type { ContractGraphNodeKey } from "./types.js";
import { evaluateRuleCondition } from "./rule-engine.js";

const NODE_DEFINITIONS: Record<ContractGraphNodeKey, { label: string; dependsOn: ContractGraphNodeKey[] }> = {
  core: { label: "Nucleo", dependsOn: [] },
  financial: { label: "Financeiro", dependsOn: ["core"] },
  execution: { label: "Execucao", dependsOn: ["core"] },
  risk: { label: "Risco", dependsOn: ["core", "financial"] },
  legal: { label: "Legal e prova", dependsOn: ["core"] },
  disputes: { label: "Disputas", dependsOn: ["core", "legal"] },
  annexes: { label: "Anexos", dependsOn: ["core"] },
};

export function buildContractGraph(
  context: ContractContext,
  clauses: ContractClause[],
  catalog: ClauseCatalog[],
  dependencies: ClauseDependency[],
): ContractGraph {
  const catalogByCode = new Map(catalog.map((item) => [item.code, item]));
  const selectedCodes = new Set(clauses.map((item) => item.clauseCode));
  const nodes = {} as ContractGraph["nodes"];

  for (const [key, definition] of Object.entries(NODE_DEFINITIONS) as Array<[ContractGraphNodeKey, (typeof NODE_DEFINITIONS)[ContractGraphNodeKey]]>) {
    nodes[key] = {
      key,
      label: definition.label,
      required:
        key === "core" ||
        key === "legal" ||
        key === "financial" ||
        (key === "execution" && context.hasDeliverables) ||
        (key === "disputes" && context.arbitrationRequested),
      status: "empty",
      clauseCodes: [],
      strengthenedBy: [],
      dependsOn: definition.dependsOn,
    } satisfies ContractGraphNode;
  }

  for (const clause of clauses) {
    nodes[clause.node].clauseCodes.push(clause.clauseCode);
    nodes[clause.node].status = nodes[clause.node].clauseCodes.length > 1 ? "reinforced" : "present";
  }

  const edges: ContractGraph["edges"] = [];
  for (const dependency of dependencies) {
    if (!selectedCodes.has(dependency.fromClauseCode) || !selectedCodes.has(dependency.toClauseCode)) continue;
    if (dependency.condition && !evaluateRuleCondition(dependency.condition, context.facts)) continue;
    const fromNode = catalogByCode.get(dependency.fromClauseCode)?.node;
    if (!fromNode) continue;
    edges.push({
      from: dependency.fromClauseCode,
      to: dependency.toClauseCode,
      kind: dependency.kind,
      rationale: dependency.rationale,
    });
    if (dependency.kind === "reinforces") {
      nodes[fromNode].strengthenedBy.push(dependency.toClauseCode);
      nodes[fromNode].status = "reinforced";
    }
  }

  return { nodes, edges };
}
