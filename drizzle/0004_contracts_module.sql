DO $$ BEGIN
  CREATE TYPE "public"."contract_status" AS ENUM('draft', 'editing', 'finalized');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."user_plan_type" AS ENUM('free', 'pro', 'premium');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "contract_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(160) NOT NULL,
  "layout_structure" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "contracts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "client_name" varchar(140) NOT NULL,
  "profession" varchar(80) NOT NULL,
  "contract_type" varchar(120) NOT NULL,
  "execution_date" timestamp NOT NULL,
  "contract_value" numeric(12, 2) NOT NULL,
  "payment_method" varchar(120) NOT NULL,
  "service_scope" text NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "template_id" integer,
  "layout_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "logo_url" text,
  "share_token_hash" varchar(128),
  "share_token_expires_at" timestamp,
  "lifecycle_status" varchar(20) DEFAULT 'DRAFT',
  "signed_at" timestamp,
  "signer_name" varchar(140),
  "signer_document" varchar(40),
  "signature_ciphertext" text,
  "signature_iv" varchar(255),
  "signature_auth_tag" varchar(255),
  "provider_signed_at" timestamp,
  "provider_contract_ciphertext" text,
  "provider_contract_iv" varchar(255),
  "provider_contract_auth_tag" varchar(255),
  "payment_released_at" timestamp,
  "payment_confirmed_at" timestamp,
  "payer_name" varchar(140),
  "payer_document" varchar(40),
  "payment_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "contracts_share_token_hash_unique" UNIQUE("share_token_hash")
);

CREATE TABLE IF NOT EXISTS "clauses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text,
  "content" text,
  "category" text,
  "profession" text,
  "description" text,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "contract_clauses" (
  "id" serial PRIMARY KEY NOT NULL,
  "contract_id" integer NOT NULL,
  "clause_id" uuid NOT NULL,
  "custom_content" text,
  "order_index" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "users_plan" (
  "user_id" integer PRIMARY KEY NOT NULL,
  "plan_type" "user_plan_type" DEFAULT 'free' NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_clause_id_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "public"."clauses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "users_plan" ADD CONSTRAINT "users_plan_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
