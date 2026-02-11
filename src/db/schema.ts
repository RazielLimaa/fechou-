import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 180 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
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
  status: varchar('status', { length: 20 }).$type<'pendente' | 'vendida' | 'cancelada'>().notNull().default('pendente'),
  acceptedAt: timestamp('accepted_at'),
  cancelledAt: timestamp('cancelled_at'),
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

export const usersRelations = relations(users, ({ many }) => ({
  proposals: many(proposals)
}));

export const proposalsRelations = relations(proposals, ({ one }) => ({
  user: one(users, {
    fields: [proposals.userId],
    references: [users.id]
  })
}));
