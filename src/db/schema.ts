import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const proposalStatusEnum = pgEnum("proposal_status", ["pendente", "vendida", "cancelada"]);
export const paymentModeEnum = pgEnum("payment_mode", ["payment", "subscription"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "paid", "failed", "expired"]);
export const proposalLifecycleStatusEnum = pgEnum("proposal_lifecycle_status", [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "PAID",
  "CANCELLED",
]);
export const providerEnum = pgEnum("payment_provider", ["mercadopago"]);
export const proposalPaymentStatusEnum = pgEnum("proposal_payment_status", [
  "PENDING",
  "CONFIRMED",
  "FAILED",
]);
export const mercadoPagoAuthMethodEnum = pgEnum("mercado_pago_auth_method", ["oauth", "api_key"]);
export const contractStatusEnum = pgEnum("contract_status", ["draft", "editing", "finalized"]);
export const userPlanTypeEnum = pgEnum("user_plan_type", ["free", "pro", "premium"]);



export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 180 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 120 }),
  stripeConnectAccountId: varchar("stripe_connect_account_id", { length: 120 }),
  pixKey: text("pix_key"),
  pixKeyType: varchar("pix_key_type", { length: 20 }),
  providerSignatureCiphertext: text("provider_signature_ciphertext"),
  providerSignatureIv:         varchar("provider_signature_iv",      { length: 255 }),
  providerSignatureAuthTag:    varchar("provider_signature_auth_tag", { length: 255 }),
  providerSignatureUpdatedAt:  timestamp("provider_signature_updated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const proposals = pgTable("proposals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  title: varchar("title", { length: 180 }).notNull(),
  clientName: varchar("client_name", { length: 140 }).notNull(),
  description: text("description").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).notNull(),

  status: proposalStatusEnum("status").notNull().default("pendente"),
  acceptedAt: timestamp("accepted_at"),
  cancelledAt: timestamp("cancelled_at"),

  shareTokenHash: varchar("share_token_hash", { length: 128 }).unique(),
  shareTokenExpiresAt: timestamp("share_token_expires_at"),

  contractSignedAt: timestamp("contract_signed_at"),
  contractSignerName: varchar("contract_signer_name", { length: 140 }),
  contractSignerDocument: varchar("contract_signer_document", { length: 40 }),
  contractSignatureHash: varchar("contract_signature_hash", { length: 128 }),
  contractSignerIp: varchar("contract_signer_ip", { length: 80 }),
  contractSignerUserAgent: varchar("contract_signer_user_agent", { length: 300 }),

  contractSignatureCiphertext: text("contract_signature_ciphertext"),
  contractSignatureIv: varchar("contract_signature_iv", { length: 255 }),
  contractSignatureAuthTag: varchar("contract_signature_auth_tag", { length: 255 }),
  contractSignatureKeyVersion: varchar("contract_signature_key_version", { length: 20 }),
  contractSignatureMimeType: varchar("contract_signature_mime_type", { length: 40 }),

  paymentReleasedAt: timestamp("payment_released_at"),
  lifecycleStatus: proposalLifecycleStatusEnum("lifecycle_status").notNull().default("DRAFT"),
  publicHash: varchar("public_hash", { length: 120 }).unique(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  summary: text("summary").notNull(),
  baseContent: text("base_content").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const paymentSessions = pgTable("payment_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  proposalId: integer("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
  mode: paymentModeEnum("mode").notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  stripeSessionId: varchar("stripe_session_id", { length: 140 }).notNull().unique(),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 140 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 140 }),
  mercadoPagoPreferenceId: varchar("mercado_pago_preference_id", { length: 140 }),
  mercadoPagoPaymentId: varchar("mercado_pago_payment_id", { length: 140 }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull().default("brl"),
  metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userSubscriptions = pgTable("user_subscriptions", {
  id: serial("id").primaryKey(), // ← CORRIGIDO: era serial("user_id"), duplicava a coluna
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 140 }).notNull().unique(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 120 }).notNull(),
  stripePriceId: varchar("stripe_price_id", { length: 140 }).notNull(),
  status: varchar("status", { length: 40 }).notNull(),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const mercadoPagoAccounts = pgTable("mercado_pago_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  mpUserId: varchar("mp_user_id", { length: 120 }),
  authMethod: mercadoPagoAuthMethodEnum("auth_method").notNull().default("oauth"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  proposalId: integer("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" })
    .unique(),
  provider: providerEnum("provider").notNull().default("mercadopago"),
  status: proposalPaymentStatusEnum("status").notNull().default("PENDING"),
  externalPreferenceId: varchar("external_preference_id", { length: 140 }),
  externalPaymentId: varchar("external_payment_id", { length: 140 }),
  paymentUrl: text("payment_url").notNull(),
  amountCents: integer("amount_cents").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contractTemplates = pgTable("contract_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  layoutStructure: jsonb("layout_structure").$type<Record<string, unknown>>().notNull().default({}),
  isDefault: boolean("is_default").notNull().default(false),
});

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  clientName: varchar("client_name", { length: 140 }).notNull(),
  profession: varchar("profession", { length: 80 }).notNull(),
  contractType: varchar("contract_type", { length: 120 }).notNull(),
  executionDate: timestamp("execution_date").notNull(),
  contractValue: numeric("contract_value", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 120 }).notNull(),
  serviceScope: text("service_scope").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  templateId: integer("template_id").references(() => contractTemplates.id, { onDelete: "set null" }),
  layoutConfig: jsonb("layout_config").$type<Record<string, unknown>>().notNull().default({}),
  logoUrl: text("logo_url"),

  shareTokenHash: varchar("share_token_hash", { length: 128 }).unique(),
  shareTokenExpiresAt: timestamp("share_token_expires_at"),

  lifecycleStatus: varchar("lifecycle_status", { length: 20 }).default("DRAFT"),

  signedAt: timestamp("signed_at"),
  signerName: varchar("signer_name", { length: 140 }),
  signerDocument: varchar("signer_document", { length: 40 }),

  signatureCiphertext: text("signature_ciphertext"),
  signatureIv: varchar("signature_iv", { length: 255 }),
  signatureAuthTag: varchar("signature_auth_tag", { length: 255 }),

  providerSignedAt:           timestamp("provider_signed_at"),
  providerContractCiphertext: text("provider_contract_ciphertext"),
  providerContractIv:         varchar("provider_contract_iv",      { length: 255 }),
  providerContractAuthTag:    varchar("provider_contract_auth_tag", { length: 255 }),

  paymentReleasedAt:  timestamp("payment_released_at"),
  paymentConfirmedAt: timestamp("payment_confirmed_at"),
  payerName:          varchar("payer_name",     { length: 140 }),
  payerDocument:      varchar("payer_document", { length: 40  }),
  paymentNote:        text("payment_note"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clauses = pgTable("clauses", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title"),
  content: text("content"),
  category: text("category"),
  profession: text("profession"),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contractClauses = pgTable("contract_clauses", {
  id: serial("id").primaryKey(),
  contractId: integer("contract_id")
    .notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  clauseId: uuid("clause_id")
    .notNull()
    .references(() => clauses.id, { onDelete: "cascade" }),
  customContent: text("custom_content"),
  orderIndex: integer("order_index").notNull().default(0),
});

export const usersPlan = pgTable("users_plan", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  planType: userPlanTypeEnum("plan_type").notNull().default("free"),
});

export const securityRateLimits = pgTable("security_rate_limits", {
  key: varchar("key", { length: 255 }).primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const securityReplayTokens = pgTable("security_replay_tokens", {
  tokenHash: varchar("token_hash", { length: 128 }).primaryKey(),
  scope: varchar("scope", { length: 80 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const securityStepUpTokens = pgTable("security_stepup_tokens", {
  tokenHash: varchar("token_hash", { length: 128 }).primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scope: varchar("scope", { length: 120 }).notNull(),
  payloadHash: varchar("payload_hash", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// SCORE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

export const userScores = pgTable("user_scores", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  score:          integer("score").notNull().default(0),
  totalSold:      integer("total_sold").notNull().default(0),
  totalCancelled: integer("total_cancelled").notNull().default(0),
  totalPending:   integer("total_pending").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contractRatings = pgTable("contract_ratings", {
  id: serial("id").primaryKey(),
  contractId: integer("contract_id")
    .notNull()
    .unique()
    .references(() => contracts.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  raterName: varchar("rater_name", { length: 140 }).notNull(),
  stars:     smallint("stars").notNull(),
  comment:   text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userProfiles = pgTable("user_profiles", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  slug:          varchar("slug",         { length: 60  }).unique(),
  displayName:   varchar("display_name", { length: 120 }),
  bio:           text("bio"),
  avatarUrl:     text("avatar_url"),
  profession:    varchar("profession",   { length: 80  }),
  location:      varchar("location",     { length: 80  }),
  linkWebsite:   text("link_website"),
  linkLinkedin:  text("link_linkedin"),
  linkInstagram: text("link_instagram"),
  linkGithub:    text("link_github"),
  linkBehance:   text("link_behance"),
  isPublic:  boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  proposals:          many(proposals),
  paymentSessions:    many(paymentSessions),
  subscriptions:      many(userSubscriptions),
  mercadoPagoAccount: many(mercadoPagoAccounts),
  contracts:          many(contracts),
  score:              one(userScores,   { fields: [users.id], references: [userScores.userId]   }),
  profile:            one(userProfiles, { fields: [users.id], references: [userProfiles.userId] }),
  ratings:            many(contractRatings),
}));

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  user: one(users, {
    fields: [contracts.userId],
    references: [users.id],
  }),
  template: one(contractTemplates, {
    fields: [contracts.templateId],
    references: [contractTemplates.id],
  }),
  clauses: many(contractClauses),
  rating: one(contractRatings, {
    fields: [contracts.id],
    references: [contractRatings.contractId],
  }),
}));

export const clausesRelations = relations(clauses, ({ many }) => ({
  contractClauses: many(contractClauses),
}));

export const contractClausesRelations = relations(contractClauses, ({ one }) => ({
  contract: one(contracts, {
    fields: [contractClauses.contractId],
    references: [contracts.id],
  }),
  clause: one(clauses, {
    fields: [contractClauses.clauseId],
    references: [clauses.id],
  }),
}));

export const proposalsRelations = relations(proposals, ({ one, many }) => ({
  user: one(users, {
    fields: [proposals.userId],
    references: [users.id],
  }),
  paymentSessions: many(paymentSessions),
  payments:        many(payments),
}));

export const paymentSessionsRelations = relations(paymentSessions, ({ one }) => ({
  user: one(users, {
    fields: [paymentSessions.userId],
    references: [users.id],
  }),
  proposal: one(proposals, {
    fields: [paymentSessions.proposalId],
    references: [proposals.id],
  }),
}));

export const mercadoPagoAccountsRelations = relations(mercadoPagoAccounts, ({ one }) => ({
  user: one(users, {
    fields: [mercadoPagoAccounts.userId],
    references: [users.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  proposal: one(proposals, {
    fields: [payments.proposalId],
    references: [proposals.id],
  }),
}));

export const userSubscriptionsRelations = relations(userSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [userSubscriptions.userId],
    references: [users.id],
  }),
}));

export const userScoresRelations = relations(userScores, ({ one }) => ({
  user: one(users, { fields: [userScores.userId], references: [users.id] }),
}));

export const contractRatingsRelations = relations(contractRatings, ({ one }) => ({
  contract: one(contracts, { fields: [contractRatings.contractId], references: [contracts.id] }),
  user:     one(users,     { fields: [contractRatings.userId],     references: [users.id]     }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.id] }),
}));

// ─── Tipos inferidos ─────────────────────────────────────────────────────────

export type UserScore      = typeof userScores.$inferSelect;
export type ContractRating = typeof contractRatings.$inferSelect;
export type UserProfile    = typeof userProfiles.$inferSelect;
