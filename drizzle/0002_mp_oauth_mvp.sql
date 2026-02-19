CREATE TYPE "public"."proposal_lifecycle_status" AS ENUM('DRAFT', 'SENT', 'ACCEPTED', 'PAID', 'CANCELLED');
CREATE TYPE "public"."payment_provider" AS ENUM('mercadopago');
CREATE TYPE "public"."proposal_payment_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');

ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "lifecycle_status" "proposal_lifecycle_status" DEFAULT 'DRAFT' NOT NULL,
  ADD COLUMN IF NOT EXISTS "public_hash" varchar(120);

CREATE UNIQUE INDEX IF NOT EXISTS "proposals_public_hash_unique"
  ON "proposals" ("public_hash");

CREATE TABLE IF NOT EXISTS "mercado_pago_accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "mp_user_id" varchar(120),
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mercado_pago_accounts_user_id_unique" UNIQUE("user_id")
);

CREATE TABLE IF NOT EXISTS "payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "proposal_id" integer NOT NULL,
  "provider" "payment_provider" DEFAULT 'mercadopago' NOT NULL,
  "status" "proposal_payment_status" DEFAULT 'PENDING' NOT NULL,
  "external_preference_id" varchar(140),
  "external_payment_id" varchar(140),
  "payment_url" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "payments_proposal_id_unique" UNIQUE("proposal_id")
);

DO $$ BEGIN
 ALTER TABLE "mercado_pago_accounts" ADD CONSTRAINT "mercado_pago_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
