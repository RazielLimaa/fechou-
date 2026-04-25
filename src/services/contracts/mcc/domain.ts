import type {
  ClauseIntensityLevel,
  ClauseSelectionStatus,
  ClauseStyleProfile,
  ContractGraphNodeKey,
  ContractKind,
  ContractLifecycleStatus,
  DateRange,
  EvidenceEventRequirement,
  EvidenceReadinessLevel,
  EvidenceRecommendationPatch,
  FactsRecord,
  FormRequirementKind,
  GraphEdgeKind,
  GraphNodeStatus,
  IntellectualPropertyMode,
  LanguageProfile,
  LegalReference,
  Money,
  PartyRelationshipKind,
  RiskSeverity,
  RuleComparator,
  RuleFactValue,
  RuleStage,
  ScoreDimensionBreakdown,
  SignatureLevel,
  ValidationCategory,
  ValidationSeverity,
  WitnessStrategy,
} from "./types.js";

export interface AuditFields {
  createdAt: string;
  updatedAt: string;
  version: number;
  createdBy?: string;
  updatedBy?: string;
}

export interface PartyProfile {
  role: "provider" | "customer" | "intermediary";
  name?: string;
  documentType: "cpf" | "cnpj" | "other";
  isBusiness: boolean;
  isConsumer: boolean;
  isAdherent: boolean;
  city?: string;
  state?: string;
}

export interface MccIntakeInput {
  contractId?: string;
  tenantId?: string;
  contractName?: string;
  contractKindHint?: ContractKind;
  freeTextSummary?: string;
  relationshipKindHint?: PartyRelationshipKind;
  isAdhesion?: boolean;
  amount: Money;
  duration?: DateRange;
  recurringBilling?: boolean;
  milestoneBilling?: boolean;
  hasDeliverables?: boolean;
  hasPersonalData?: boolean;
  hasSensitiveData?: boolean;
  handlesIntellectualProperty?: boolean;
  ipMode?: IntellectualPropertyMode;
  sourceCodeDelivery?: boolean;
  arbitrationRequested?: boolean;
  executiveTitlePriority?: boolean;
  involvesRealEstate?: boolean;
  formRequirementHint?: FormRequirementKind;
  desiredLanguageProfile?: LanguageProfile;
  businessContextTags?: string[];
  parties: PartyProfile[];
  facts?: FactsRecord;
}

export interface ContractContext {
  id: string;
  tenantId?: string;
  contractId?: string;
  contractName?: string;
  contractKind: ContractKind;
  relationshipKind: PartyRelationshipKind;
  consumerContext: boolean;
  adhesionContext: boolean;
  amount: Money;
  amountBand: "low" | "medium" | "high";
  duration?: DateRange;
  recurringBilling: boolean;
  milestoneBilling: boolean;
  hasDeliverables: boolean;
  hasPersonalData: boolean;
  hasSensitiveData: boolean;
  handlesIntellectualProperty: boolean;
  ipMode: IntellectualPropertyMode;
  sourceCodeDelivery: boolean;
  arbitrationRequested: boolean;
  executiveTitlePriority: boolean;
  involvesRealEstate: boolean;
  formRequirement: FormRequirementKind;
  desiredLanguageProfile: LanguageProfile;
  parties: PartyProfile[];
  facts: FactsRecord;
  legalReferences: LegalReference[];
  audit: AuditFields;
}

export interface ClauseCatalog {
  id: string;
  code: string;
  title: string;
  description: string;
  node: ContractGraphNodeKey;
  appliesToKinds: Array<ContractKind | "any">;
  appliesToRelationships: Array<PartyRelationshipKind | "any">;
  baseRequired: boolean;
  defaultIntensity: ClauseIntensityLevel;
  sortOrder: number;
  legalReferences: LegalReference[];
  riskTags: string[];
  version: string;
  active: boolean;
}

export interface ClauseVariant {
  id: string;
  clauseCode: string;
  intensity: ClauseIntensityLevel;
  rigidity: ClauseStyleProfile["rigidity"];
  language: ClauseStyleProfile["language"];
  summary: string;
  templateKey: string;
  guardrails: string[];
  legalReferences: LegalReference[];
  version: string;
  active: boolean;
}

export type RuleCondition =
  | { kind: "all"; conditions: RuleCondition[] }
  | { kind: "any"; conditions: RuleCondition[] }
  | { kind: "not"; condition: RuleCondition }
  | { kind: "fact"; fact: string; operator: RuleComparator; value?: RuleFactValue | RuleFactValue[] };

export interface RiskItemInput {
  code: string;
  severity: RiskSeverity;
  title: string;
  description: string;
  mitigation: string;
}

export interface ValidationIssueInput {
  code: string;
  severity: ValidationSeverity;
  category: ValidationCategory;
  impact: string;
  message: string;
  userMessage: string;
  recommendation: string;
  legalReferences?: LegalReference[];
  clauseCodes?: string[];
  blocking?: boolean;
}

export type RuleAction =
  | { type: "select_clause"; clauseCode: string; intensity?: ClauseIntensityLevel; reason: string; required?: boolean }
  | { type: "exclude_clause"; clauseCode: string; reason: string }
  | { type: "raise_risk"; risk: RiskItemInput; legalReferences?: LegalReference[] }
  | { type: "raise_issue"; issue: ValidationIssueInput }
  | { type: "set_evidence"; patch: EvidenceRecommendationPatch; reason: string }
  | { type: "set_fact"; fact: string; value: RuleFactValue; reason: string };

export interface ClauseRule {
  id: string;
  code: string;
  name: string;
  priority: number;
  stage: RuleStage;
  mandatory: boolean;
  when: RuleCondition;
  actions: RuleAction[];
  dependsOnRuleIds?: string[];
  conflictGroup?: string;
  fallbackActions?: RuleAction[];
  legalReferences: LegalReference[];
  rationale: string;
  active: boolean;
}

export interface ClauseDependency {
  id: string;
  fromClauseCode: string;
  toClauseCode: string;
  kind: GraphEdgeKind;
  condition?: RuleCondition;
  rationale: string;
}

export interface ContractClause {
  clauseCode: string;
  variantId: string;
  title: string;
  node: ContractGraphNodeKey;
  position: number;
  status: ClauseSelectionStatus;
  style: ClauseStyleProfile;
  reason: string;
  required: boolean;
  dependencySource: string[];
  legalReferences: LegalReference[];
}

export interface RiskItem extends RiskItemInput {
  source: "context" | "rule" | "validation";
  legalReferences: LegalReference[];
}

export interface RiskProfile {
  overall: RiskSeverity;
  items: RiskItem[];
  tags: string[];
}

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  category: ValidationCategory;
  impact: string;
  message: string;
  userMessage: string;
  recommendation: string;
  legalReferences: LegalReference[];
  clauseCodes: string[];
  blocking: boolean;
}

export interface ContractScorePenalty {
  code: string;
  points: number;
  reason: string;
}

export interface ContractScore {
  total: number;
  grade: "A" | "B" | "C" | "D" | "E";
  dimensions: ScoreDimensionBreakdown;
  penalties: ContractScorePenalty[];
}

export interface EvidenceProfile {
  recommendedSignature: SignatureLevel;
  witnesses: WitnessStrategy;
  requiredEvents: EvidenceEventRequirement[];
  captureIp: boolean;
  captureUserAgent: boolean;
  captureTimestamp: boolean;
  captureDocumentHash: boolean;
  captureAcceptanceRecord: boolean;
  targetExecutiveTitle: boolean;
  executiveTitleReadiness: EvidenceReadinessLevel;
  notes: string[];
}

export interface ContractGraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  rationale: string;
}

export interface ContractGraphNode {
  key: ContractGraphNodeKey;
  label: string;
  required: boolean;
  status: GraphNodeStatus;
  clauseCodes: string[];
  strengthenedBy: string[];
  dependsOn: ContractGraphNodeKey[];
}

export interface ContractGraph {
  nodes: Record<ContractGraphNodeKey, ContractGraphNode>;
  edges: ContractGraphEdge[];
}

export interface ContractSnapshot {
  id: string;
  contractId?: string;
  version: number;
  renderedHash: string;
  contextHash: string;
  graphHash: string;
  scoreHash: string;
  createdAt: string;
  createdBy?: string;
}

export interface DecisionLog {
  id: string;
  stage: RuleStage | "risk" | "context" | "dependency" | "validation" | "score" | "snapshot";
  ruleId?: string;
  actionType: string;
  subjectType: string;
  subjectId?: string;
  summary: string;
  rationale: string;
  evidence: Record<string, unknown>;
  legalReferences: LegalReference[];
  happenedAt: string;
}

export interface ContractDraft {
  id: string;
  contractId?: string;
  status: ContractLifecycleStatus;
  context: ContractContext;
  clauses: ContractClause[];
  graph: ContractGraph;
  riskProfile: RiskProfile;
  validationIssues: ValidationIssue[];
  score: ContractScore;
  evidenceProfile: EvidenceProfile;
  decisions: DecisionLog[];
  snapshot: ContractSnapshot;
  audit: AuditFields;
}

export interface Contract {
  id: string;
  tenantId?: string;
  status: ContractLifecycleStatus;
  currentSnapshotId?: string;
  latestDraft?: ContractDraft;
  audit: AuditFields;
}

export interface MccRunResult {
  draft: ContractDraft;
  summary: {
    classification: string;
    blockers: number;
    warnings: number;
    suggestedActions: string[];
  };
}
