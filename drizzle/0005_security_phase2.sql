CREATE TABLE IF NOT EXISTS security_rate_limits (
  key varchar(255) PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  window_start timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_replay_tokens (
  token_hash varchar(128) PRIMARY KEY,
  scope varchar(80) NOT NULL,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_stepup_tokens (
  token_hash varchar(128) PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope varchar(120) NOT NULL,
  payload_hash varchar(128) NOT NULL,
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_replay_tokens_expires_at ON security_replay_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_security_rate_limits_updated_at ON security_rate_limits(updated_at);
CREATE INDEX IF NOT EXISTS idx_security_stepup_tokens_user_scope_expires ON security_stepup_tokens(user_id, scope, expires_at);

-- Refresh token hardening columns
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS last_used_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS absolute_expires_at timestamp with time zone;

UPDATE refresh_tokens
SET last_used_at = COALESCE(last_used_at, created_at),
    absolute_expires_at = COALESCE(absolute_expires_at, created_at + interval '30 days')
WHERE last_used_at IS NULL OR absolute_expires_at IS NULL;

-- RLS rollout (safe mode)
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposals_owner_policy ON proposals;
CREATE POLICY proposals_owner_policy ON proposals
  USING (user_id = current_setting('app.user_id', true)::integer)
  WITH CHECK (user_id = current_setting('app.user_id', true)::integer);

DROP POLICY IF EXISTS contracts_owner_policy ON contracts;
CREATE POLICY contracts_owner_policy ON contracts
  USING (user_id = current_setting('app.user_id', true)::integer)
  WITH CHECK (user_id = current_setting('app.user_id', true)::integer);

DROP POLICY IF EXISTS payments_owner_policy ON payments;
CREATE POLICY payments_owner_policy ON payments
  USING (
    EXISTS (
      SELECT 1 FROM proposals p
      WHERE p.id = payments.proposal_id
        AND p.user_id = current_setting('app.user_id', true)::integer
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM proposals p
      WHERE p.id = payments.proposal_id
        AND p.user_id = current_setting('app.user_id', true)::integer
    )
  );

DROP POLICY IF EXISTS payment_sessions_owner_policy ON payment_sessions;
CREATE POLICY payment_sessions_owner_policy ON payment_sessions
  USING (user_id = current_setting('app.user_id', true)::integer)
  WITH CHECK (user_id = current_setting('app.user_id', true)::integer);

DROP POLICY IF EXISTS user_profiles_owner_policy ON user_profiles;
CREATE POLICY user_profiles_owner_policy ON user_profiles
  USING (user_id = current_setting('app.user_id', true)::integer)
  WITH CHECK (user_id = current_setting('app.user_id', true)::integer);
