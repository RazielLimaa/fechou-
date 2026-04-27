import { sql } from 'drizzle-orm';
import { db } from './index.js';

let ensurePromise: Promise<void> | null = null;

async function execute(statement: ReturnType<typeof sql>) {
  await db.execute(statement);
}

async function ensureAuthInfrastructureNow() {
  await execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id varchar(255)`);
  await execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text`);
  await execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false`);
  await execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL`);

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

  await execute(sql`
    DO $$ BEGIN
      CREATE TYPE payment_mode AS ENUM ('payment', 'subscription');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);
  await execute(sql`
    DO $$ BEGIN
      CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'expired');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);
  await execute(sql`
    CREATE TABLE IF NOT EXISTS payment_sessions (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      proposal_id integer REFERENCES proposals(id) ON DELETE SET NULL,
      mode payment_mode NOT NULL,
      status payment_status NOT NULL DEFAULT 'pending',
      stripe_session_id varchar(140) NOT NULL UNIQUE,
      stripe_payment_intent_id varchar(140),
      stripe_subscription_id varchar(140),
      mercado_pago_preference_id varchar(140),
      mercado_pago_payment_id varchar(140),
      amount numeric(12, 2) NOT NULL,
      currency varchar(10) NOT NULL DEFAULT 'brl',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_payment_sessions_user_id ON payment_sessions(user_id)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_payment_sessions_status ON payment_sessions(status)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_payment_sessions_created_at ON payment_sessions(created_at)`);

  await execute(sql`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stripe_subscription_id varchar(140) NOT NULL UNIQUE,
      stripe_customer_id varchar(120) NOT NULL,
      stripe_price_id varchar(140) NOT NULL,
      status varchar(40) NOT NULL,
      current_period_end timestamp with time zone,
      cancel_at_period_end boolean NOT NULL DEFAULT false,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await execute(sql`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS id serial`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id)`);
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status)`);
}

export function ensureAuthInfrastructure() {
  ensurePromise ??= ensureAuthInfrastructureNow();
  return ensurePromise;
}
