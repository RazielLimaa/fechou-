import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// End-state MCC schema blueprint.
// Keep isolated from schema.ts until the legacy contracts schema is migrated.

export const mccContractKindEnum = pgEnum("mcc_contract_kind", [
  "service_agreement",
  "project_statement",
  "saas",
  "license",
  "nda",
  "partnership",
  "real_estate",
]);

export const mccRelationshipKindEnum = pgEnum("mcc_relationship_kind", ["b2b", "b2c"]);
export const mccContractStatusEnum = pgEnum("mcc_contract_status", ["draft", "modeled", "approved", "signed", "archived"]);
export const mccClauseIntensityEnum = pgEnum("mcc_clause_intensity", ["light", "medium", "strong"]);
export const mccValidationSeverityEnum = pgEnum("mcc_validation_severity", ["info", "warning", "error", "blocker"]);
export const mccSignatureLevelEnum = pgEnum("mcc_signature_level", ["simple", "advanced", "qualified"]);

export const mccContracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id"),
    ownerUserId: integer("owner_user_id").notNull(),
    status: mccContractStatusEnum("status").notNull().default("draft"),
    kind: mccContractKindEnum("kind").notNull(),
    relationshipKind: mccRelationshipKindEnum("relationship_kind").notNull(),
    adhesionContext: boolean("adhesion_context").notNull().default(false),
    consumerContext: boolean("consumer_context").notNull().default(false),
    amountCents: numeric("amount_cents", { precision: 14, scale: 0 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("BRL"),
    currentSnapshotId: uuid("current_snapshot_id"),
    modelingVersion: varchar("modeling_version", { length: 40 }).notNull().default("mcc-1.0.0"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    version: integer("version").notNull().default(1),
    createdBy: integer("created_by"),
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    ownerIdx: index("contracts_owner_idx").on(table.ownerUserId),
    statusIdx: index("contracts_status_idx").on(table.status),
    kindIdx: index("contracts_kind_idx").on(table.kind),
  }),
);

export const mccContractContexts = pgTable(
  "contract_contexts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => mccContracts.id, { onDelete: "cascade" }),
    contextVersion: integer("context_version").notNull().default(1),
    facts: jsonb("facts").$type<Record<string, unknown>>().notNull().default({}),
    normalizedContext: jsonb("normalized_context").$type<Record<string, unknown>>().notNull(),
    rawInput: jsonb("raw_input").$type<Record<string, unknown>>().notNull(),
    legalReferences: jsonb("legal_references").$type<Array<Record<string, unknown>>>().notNull().default([]),
    contextHash: varchar("context_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    contractVersionIdx: uniqueIndex("contract_contexts_contract_version_uidx").on(table.contractId, table.contextVersion),
    hashIdx: index("contract_contexts_hash_idx").on(table.contextHash),
  }),
);

export const mccClauseCatalog = pgTable(
  "clause_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 120 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    node: varchar("node", { length: 40 }).notNull(),
    description: text("description").notNull(),
    riskTags: jsonb("risk_tags").$type<string[]>().notNull().default([]),
    legalReferences: jsonb("legal_references").$type<Array<Record<string, unknown>>>().notNull().default([]),
    baseRequired: boolean("base_required").notNull().default(false),
    defaultIntensity: mccClauseIntensityEnum("default_intensity").notNull().default("medium"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    version: varchar("version", { length: 40 }).notNull().default("1.0.0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    codeUidx: uniqueIndex("clause_catalog_code_uidx").on(table.code),
    activeIdx: index("clause_catalog_active_idx").on(table.active),
    nodeIdx: index("clause_catalog_node_idx").on(table.node),
  }),
);

export const mccClauseVariants = pgTable(
  "clause_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clauseId: uuid("clause_id").notNull().references(() => mccClauseCatalog.id, { onDelete: "cascade" }),
    clauseCode: varchar("clause_code", { length: 120 }).notNull(),
    intensity: mccClauseIntensityEnum("intensity").notNull(),
    languageProfile: varchar("language_profile", { length: 40 }).notNull(),
    rigidity: varchar("rigidity", { length: 40 }).notNull(),
    templateKey: varchar("template_key", { length: 160 }).notNull(),
    summary: text("summary").notNull(),
    template: text("template").notNull(),
    guardrails: jsonb("guardrails").$type<string[]>().notNull().default([]),
    legalReferences: jsonb("legal_references").$type<Array<Record<string, unknown>>>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    version: varchar("version", { length: 40 }).notNull().default("1.0.0"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    clauseIntensityUidx: uniqueIndex("clause_variants_clause_intensity_uidx").on(table.clauseCode, table.intensity, table.version),
    clauseIdx: index("clause_variants_clause_idx").on(table.clauseId),
    hashIdx: index("clause_variants_hash_idx").on(table.contentHash),
  }),
);

export const mccClauseRules = pgTable(
  "clause_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 140 }).notNull(),
    priority: integer("priority").notNull(),
    stage: varchar("stage", { length: 40 }).notNull(),
    mandatory: boolean("mandatory").notNull().default(false),
    condition: jsonb("condition").$type<Record<string, unknown>>().notNull(),
    actions: jsonb("actions").$type<Array<Record<string, unknown>>>().notNull(),
    fallbackActions: jsonb("fallback_actions").$type<Array<Record<string, unknown>>>().notNull().default([]),
    conflictGroup: varchar("conflict_group", { length: 120 }),
    rationale: text("rationale").notNull(),
    legalReferences: jsonb("legal_references").$type<Array<Record<string, unknown>>>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    version: varchar("version", { length: 40 }).notNull().default("1.0.0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    codeUidx: uniqueIndex("clause_rules_code_uidx").on(table.code, table.version),
    priorityIdx: index("clause_rules_priority_idx").on(table.priority),
    activeIdx: index("clause_rules_active_idx").on(table.active),
  }),
);

export const mccClauseDependencies = pgTable(
  "clause_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromClauseCode: varchar("from_clause_code", { length: 120 }).notNull(),
    toClauseCode: varchar("to_clause_code", { length: 120 }).notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    condition: jsonb("condition").$type<Record<string, unknown>>(),
    rationale: text("rationale").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    fromIdx: index("clause_dependencies_from_idx").on(table.fromClauseCode),
    toIdx: index("clause_dependencies_to_idx").on(table.toClauseCode),
  }),
);

export const mccContractClauses = pgTable(
  "contract_clauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => mccContracts.id, { onDelete: "cascade" }),
    clauseCode: varchar("clause_code", { length: 120 }).notNull(),
    clauseVariantId: uuid("clause_variant_id").references(() => mccClauseVariants.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    node: varchar("node", { length: 40 }).notNull(),
    intensity: mccClauseIntensityEnum("intensity").notNull(),
    renderedContent: text("rendered_content"),
    variables: jsonb("variables").$type<Record<string, unknown>>().notNull().default({}),
    decisionRefs: jsonb("decision_refs").$type<string[]>().notNull().default([]),
    dependencySource: jsonb("dependency_source").$type<string[]>().notNull().default([]),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    contractPositionUidx: uniqueIndex("contract_clauses_contract_position_uidx").on(table.contractId, table.position),
    contractClauseUidx: uniqueIndex("contract_clauses_contract_code_uidx").on(table.contractId, table.clauseCode),
    contractIdx: index("contract_clauses_contract_idx").on(table.contractId),
  }),
);

export const mccValidationIssues = pgTable(
  "validation_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => mccContracts.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id"),
    code: varchar("code", { length: 140 }).notNull(),
    severity: mccValidationSeverityEnum("severity").notNull(),
    category: varchar("category", { length: 60 }).notNull(),
    blocking: boolean("blocking").notNull().default(false),
    impact: text("impact").notNull(),
    message: text("message").notNull(),
    userMessage: text("user_message").notNull(),
    recommendation: text("recommendation").notNull(),
    clauseCodes: jsonb("clause_codes").$type<string[]>().notNull().default([]),
    legalReferences: jsonb("legal_references").$type<Array<Record<string, unknown>>>().notNull().default([]),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    contractIdx: index("validation_issues_contract_idx").on(table.contractId),
    severityIdx: index("validation_issues_severity_idx").on(table.severity),
    codeIdx: index("validation_issues_code_idx").on(table.code),
  }),
);

export const mccContractScores = pgTable(
  "contract_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => mccContracts.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id"),
    total: integer("total").notNull(),
    grade: varchar("grade", { length: 2 }).notNull(),
    dimensions: jsonb("dimensions").$type<Record<string, number>>().notNull(),
    penalties: jsonb("penalties").$type<Array<Record<string, unknown>>>().notNull().default([]),
    scoreHash: varchar("score_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    contractIdx: index("contract_scores_contract_idx").on(table.contractId),
    snapshotUidx: uniqueIndex("contract_scores_snapshot_uidx").on(table.snapshotId),
  }),
);

export const mccEvidenceProfiles = pgTable(
  "evidence_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => mccContracts.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id"),
    recommendedSignature: mccSignatureLevelEnum("recommended_signature").notNull(),
    witnesses: varchar("witnesses", { length: 40 }).notNull(),
    targetExecutiveTitle: boolean("target_executive_title").notNull().default(false),
    readiness: varchar("readiness", { length: 40 }).notNull(),
    requiredEvents: jsonb("required_events").$type<Array<Record<string, unknown>>>().notNull().default([]),
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    profileHash: varchar("profile_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    contractIdx: index("evidence_profiles_contract_idx").on(table.contractId),
    snapshotUidx: uniqueIndex("evidence_profiles_snapshot_uidx").on(table.snapshotId),
  }),
);

export const mccDecisionLogs = pgTable(
  "decision_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => mccContracts.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id"),
    stage: varchar("stage", { length: 40 }).notNull(),
    ruleId: varchar("rule_id", { length: 160 }),
    actionType: varchar("action_type", { length: 80 }).notNull(),
    subjectType: varchar("subject_type", { length: 80 }).notNull(),
    subjectId: varchar("subject_id", { length: 160 }),
    summary: text("summary").notNull(),
    rationale: text("rationale").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    legalReferences: jsonb("legal_references").$type<Array<Record<string, unknown>>>().notNull().default([]),
    previousHash: varchar("previous_hash", { length: 64 }),
    entryHash: varchar("entry_hash", { length: 64 }).notNull(),
    happenedAt: timestamp("happened_at").notNull().defaultNow(),
  },
  (table) => ({
    contractIdx: index("decision_logs_contract_idx").on(table.contractId),
    snapshotIdx: index("decision_logs_snapshot_idx").on(table.snapshotId),
    hashUidx: uniqueIndex("decision_logs_hash_uidx").on(table.entryHash),
  }),
);

export const mccContractSnapshots = pgTable(
  "contract_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => mccContracts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    renderedHash: varchar("rendered_hash", { length: 64 }).notNull(),
    contextHash: varchar("context_hash", { length: 64 }).notNull(),
    graphHash: varchar("graph_hash", { length: 64 }).notNull(),
    scoreHash: varchar("score_hash", { length: 64 }).notNull(),
    evidenceHash: varchar("evidence_hash", { length: 64 }).notNull(),
    decisionLogHeadHash: varchar("decision_log_head_hash", { length: 64 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    contractVersionUidx: uniqueIndex("contract_snapshots_contract_version_uidx").on(table.contractId, table.version),
    contractIdx: index("contract_snapshots_contract_idx").on(table.contractId),
    renderedHashIdx: index("contract_snapshots_rendered_hash_idx").on(table.renderedHash),
  }),
);
