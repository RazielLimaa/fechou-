CREATE TYPE "public"."mercado_pago_auth_method" AS ENUM('oauth', 'api_key');

ALTER TABLE "mercado_pago_accounts"
  ADD COLUMN IF NOT EXISTS "auth_method" "mercado_pago_auth_method" DEFAULT 'oauth' NOT NULL;
