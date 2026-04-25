export const contractKinds = [
  "service_agreement",
  "project_statement",
  "saas",
  "license",
  "nda",
  "partnership",
  "real_estate",
] as const;

export type ContractKind = (typeof contractKinds)[number];

export const partyRelationshipKinds = ["b2b", "b2c"] as const;
export type PartyRelationshipKind = (typeof partyRelationshipKinds)[number];

export const intellectualPropertyModes = ["none", "license", "assignment", "provider_owned"] as const;
export type IntellectualPropertyMode = (typeof intellectualPropertyModes)[number];

export const formRequirementKinds = ["free_form", "written", "public_deed", "special_form"] as const;
export type FormRequirementKind = (typeof formRequirementKinds)[number];

export const clauseIntensityLevels = ["light", "medium", "strong"] as const;
export type ClauseIntensityLevel = (typeof clauseIntensityLevels)[number];

export const clauseRigidityLevels = ["flexible", "balanced", "strict"] as const;
export type ClauseRigidityLevel = (typeof clauseRigidityLevels)[number];

export const languageProfiles = ["plain_portuguese", "formal", "technical", "consumer_friendly"] as const;
export type LanguageProfile = (typeof languageProfiles)[number];

export const contractGraphNodeKeys = ["core", "financial", "execution", "risk", "legal", "disputes", "annexes"] as const;
export type ContractGraphNodeKey = (typeof contractGraphNodeKeys)[number];

export const graphEdgeKinds = ["requires", "reinforces", "conflicts_with", "fallback_to"] as const;
export type GraphEdgeKind = (typeof graphEdgeKinds)[number];

export const graphNodeStatuses = ["empty", "present", "reinforced"] as const;
export type GraphNodeStatus = (typeof graphNodeStatuses)[number];

export const validationSeverities = ["info", "warning", "error", "blocker"] as const;
export type ValidationSeverity = (typeof validationSeverities)[number];

export const validationCategories = [
  "legal_coverage",
  "financial",
  "evidence",
  "consistency",
  "lgpd",
  "arbitration",
  "form",
  "consumer",
  "ip",
] as const;
export type ValidationCategory = (typeof validationCategories)[number];

export const riskSeverities = ["low", "medium", "high", "critical"] as const;
export type RiskSeverity = (typeof riskSeverities)[number];

export const signatureLevels = ["simple", "advanced", "qualified"] as const;
export type SignatureLevel = (typeof signatureLevels)[number];

export const witnessStrategies = ["not_needed", "recommended", "required_for_target"] as const;
export type WitnessStrategy = (typeof witnessStrategies)[number];

export const evidenceReadinessLevels = ["weak", "reinforced", "strong"] as const;
export type EvidenceReadinessLevel = (typeof evidenceReadinessLevels)[number];

export const ruleStages = ["classification", "composition", "evidence", "validation"] as const;
export type RuleStage = (typeof ruleStages)[number];

export const ruleComparators = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "truthy", "falsy"] as const;
export type RuleComparator = (typeof ruleComparators)[number];

export const ruleActionTypes = ["select_clause", "exclude_clause", "raise_risk", "raise_issue", "set_evidence", "set_fact"] as const;
export type RuleActionType = (typeof ruleActionTypes)[number];

export const clauseSelectionStatuses = ["selected", "derived", "blocked"] as const;
export type ClauseSelectionStatus = (typeof clauseSelectionStatuses)[number];

export const contractLifecycleStatuses = ["draft", "modeled", "approved", "signed", "archived"] as const;
export type ContractLifecycleStatus = (typeof contractLifecycleStatuses)[number];

export type RuleFactValue = string | number | boolean | null;
export type FactsRecord = Record<string, RuleFactValue>;

export interface LegalReference {
  sourceId: string;
  label: string;
  article?: string;
  url?: string;
  note?: string;
}

export interface Money {
  amountCents: number;
  currency: string;
}

export interface DateRange {
  startsAt?: string;
  endsAt?: string;
}

export interface ClauseStyleProfile {
  intensity: ClauseIntensityLevel;
  rigidity: ClauseRigidityLevel;
  language: LanguageProfile;
}

export interface EvidenceEventRequirement {
  code: string;
  required: boolean;
  description: string;
  fields: string[];
}

export interface EvidenceRecommendationPatch {
  recommendedSignature?: SignatureLevel;
  witnesses?: WitnessStrategy;
  executiveTitleReadiness?: EvidenceReadinessLevel;
  requiredEvents?: EvidenceEventRequirement[];
  addNotes?: string[];
}

export interface ScoreDimensionBreakdown {
  legalCoverage: number;
  financialProtection: number;
  clarity: number;
  evidence: number;
  legalBalance: number;
}
