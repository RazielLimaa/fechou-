import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar
} from 'drizzle-orm/pg-core';

export const proposalStatusEnum = pgEnum('proposal_status', ['pendente', 'vendida', 'cancelada']);
export const paymentModeEnum = pgEnum('payment_mode', ['payment', 'subscription']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'paid', 'failed', 'expired']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 180 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 120 }),
  stripeConnectAccountId: varchar('stripe_connect_account_id', { length: 120 }),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

export const proposals = pgTable('proposals', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 180 }).notNull(),
  clientName: varchar('client_name', { length: 140 }).notNull(),
  description: text('description').notNull(),
  value: numeric('value', { precision: 12, scale: 2 }).notNull(),
  status: proposalStatusEnum('status').notNull().default('pendente'),
  acceptedAt: timestamp('accepted_at'),
  cancelledAt: timestamp('cancelled_at'),
  shareTokenHash: varchar('share_token_hash', { length: 128 }).unique(),
  shareTokenExpiresAt: timestamp('share_token_expires_at'),
  contractSignedAt: timestamp('contract_signed_at'),
  contractSignerName: varchar('contract_signer_name', { length: 140 }),
  contractSignatureHash: varchar('contract_signature_hash', { length: 128 }),
  paymentReleasedAt: timestamp('payment_released_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const templates = pgTable('templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  category: varchar('category', { length: 100 }).notNull(),
  summary: text('summary').notNull(),
  baseContent: text('base_content').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

export const paymentSessions = pgTable('payment_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  proposalId: integer('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
  mode: paymentModeEnum('mode').notNull(),
  status: paymentStatusEnum('status').notNull().default('pending'),
  stripeSessionId: varchar('stripe_session_id', { length: 140 }).notNull().unique(),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 140 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 140 }),
  mercadoPagoPreferenceId: varchar('mercado_pago_preference_id', { length: 140 }),
  mercadoPagoPaymentId: varchar('mercado_pago_payment_id', { length: 140 }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('brl'),
  metadata: jsonb('metadata').$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const userSubscriptions = pgTable('user_subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 140 }).notNull().unique(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 120 }).notNull(),
  stripePriceId: varchar('stripe_price_id', { length: 140 }).notNull(),
  status: varchar('status', { length: 40 }).notNull(),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const usersRelations = relations(users, ({ many }) => ({
  proposals: many(proposals),
  paymentSessions: many(paymentSessions),
  subscriptions: many(userSubscriptions)
}));

export const proposalsRelations = relations(proposals, ({ one, many }) => ({
  user: one(users, {
    fields: [proposals.userId],
    references: [users.id]
  }),
  paymentSessions: many(paymentSessions)
}));

export const paymentSessionsRelations = relations(paymentSessions, ({ one }) => ({
  user: one(users, {
    fields: [paymentSessions.userId],
    references: [users.id]
  }),
  proposal: one(proposals, {
    fields: [paymentSessions.proposalId],
    references: [proposals.id]
  })
}));

export const userSubscriptionsRelations = relations(userSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [userSubscriptions.userId],
    references: [users.id]
  })
}));
