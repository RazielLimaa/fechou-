import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "../db/schema.js"; 
// ── Refresh tokens ────────────────────────────────────────────────────────────
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id:        serial("id").primaryKey(),
    userId:    integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    family:    uuid("family").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revoked:   boolean("revoked").notNull().default(false),
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdIdx:    index("idx_rt_user_id").on(t.userId),
    tokenHashIdx: index("idx_rt_token_hash").on(t.tokenHash),
    familyIdx:    index("idx_rt_family").on(t.family),
  })
);

// ── Log de tentativas de login ────────────────────────────────────────────────
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id:        serial("id").primaryKey(),
    email:     varchar("email", { length: 180 }).notNull(),
    ipAddress: varchar("ip_address", { length: 80 }).notNull(),
    success:   boolean("success").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: index("idx_la_email").on(t.email, t.createdAt),
    ipIdx:    index("idx_la_ip").on(t.ipAddress, t.createdAt),
  })
);

// ── Tipos inferidos ───────────────────────────────────────────────────────────
export type RefreshToken  = typeof refreshTokens.$inferSelect;
export type LoginAttempt  = typeof loginAttempts.$inferSelect;
