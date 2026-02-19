ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "share_token_hash" varchar(128),
  ADD COLUMN IF NOT EXISTS "share_token_expires_at" timestamp,
  ADD COLUMN IF NOT EXISTS "contract_signed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "contract_signer_name" varchar(140),
  ADD COLUMN IF NOT EXISTS "contract_signature_hash" varchar(128),
  ADD COLUMN IF NOT EXISTS "payment_released_at" timestamp;

ALTER TABLE "payment_sessions"
  ADD COLUMN IF NOT EXISTS "mercado_pago_preference_id" varchar(140),
  ADD COLUMN IF NOT EXISTS "mercado_pago_payment_id" varchar(140);

CREATE UNIQUE INDEX IF NOT EXISTS "proposals_share_token_hash_unique"
  ON "proposals" ("share_token_hash");
