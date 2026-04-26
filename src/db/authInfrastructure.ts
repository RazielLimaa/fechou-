import { sql } from 'drizzle-orm';
import { db } from './index.js';

let ensurePromise: Promise<void> | null = null;

async function execute(statement: ReturnType<typeof sql>) {
  await db.execute(statement);
}

async function ensureAuthInfrastructureNow() {
  await execute(sql`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash varchar(128) NOT NULL UNIQUE,
      family uuid NOT NULL,
      expires_at timestamp with time zone NOT NULL,
      absolute_expires_at timestamp with time zone,
      last_used_at timestamp with time zone,
      revoked boolean NOT NULL DEFAULT false,
      user_agent text,
      ip_address varchar(80),
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_rt_user_id ON refresh_tokens(user_id)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_rt_token_hash ON refresh_tokens(token_hash)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_rt_family ON refresh_tokens(family)`);

  await execute(sql`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id serial PRIMARY KEY,
      email varchar(180) NOT NULL,
      ip_address varchar(80) NOT NULL,
      success boolean NOT NULL DEFAULT false,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_la_email ON login_attempts(email, created_at)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_la_ip ON login_attempts(ip_address, created_at)`);

  await execute(sql`
    CREATE TABLE IF NOT EXISTS security_rate_limits (
      key varchar(255) PRIMARY KEY,
      count integer NOT NULL DEFAULT 0,
      window_start timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await execute(sql`
    CREATE TABLE IF NOT EXISTS security_replay_tokens (
      token_hash varchar(128) PRIMARY KEY,
      scope varchar(80) NOT NULL,
      expires_at timestamp with time zone NOT NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await execute(sql`
    CREATE TABLE IF NOT EXISTS security_stepup_tokens (
      token_hash varchar(128) PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope varchar(120) NOT NULL,
      payload_hash varchar(128) NOT NULL,
      expires_at timestamp with time zone NOT NULL,
      used_at timestamp with time zone,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_security_replay_tokens_expires_at ON security_replay_tokens(expires_at)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_security_rate_limits_updated_at ON security_rate_limits(updated_at)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_security_stepup_tokens_user_scope_expires ON security_stepup_tokens(user_id, scope, expires_at)`);

  await execute(sql`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash varchar(128) NOT NULL UNIQUE,
      expires_at timestamp with time zone NOT NULL,
      used_at timestamp with time zone,
      requested_ip varchar(80),
      requested_user_agent text,
      used_ip varchar(80),
      used_user_agent text,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id, created_at)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens(expires_at)`);

  await execute(sql`
    CREATE TABLE IF NOT EXISTS password_reset_challenges (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash varchar(128) NOT NULL,
      expires_at timestamp with time zone NOT NULL,
      verified_at timestamp with time zone,
      consumed_at timestamp with time zone,
      requested_ip varchar(80),
      requested_user_agent text,
      verified_ip varchar(80),
      verified_user_agent text,
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_prc_user_id ON password_reset_challenges(user_id, created_at)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_prc_code_hash ON password_reset_challenges(code_hash)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_prc_expires_at ON password_reset_challenges(expires_at)`);
}

export function ensureAuthInfrastructure() {
  ensurePromise ??= ensureAuthInfrastructureNow();
  return ensurePromise;
}
