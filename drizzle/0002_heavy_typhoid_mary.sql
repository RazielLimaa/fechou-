CREATE TYPE "public"."contract_status" AS ENUM('draft', 'editing', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."mercado_pago_auth_method" AS ENUM('oauth', 'api_key');--> statement-breakpoint
CREATE TYPE "public"."proposal_lifecycle_status" AS ENUM('DRAFT', 'SENT', 'ACCEPTED', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."proposal_payment_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('mercadopago');--> statement-breakpoint
CREATE TYPE "public"."user_plan_type" AS ENUM('free', 'pro', 'premium');--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_clauses" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"clause_id" uuid NOT NULL,
	"custom_content" text,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"rater_name" varchar(140) NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_ratings_contract_id_unique" UNIQUE("contract_id")
);
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mercado_pago_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mp_user_id" varchar(120),
	"auth_method" "mercado_pago_auth_method" DEFAULT 'oauth' NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mercado_pago_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profiles" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"slug" varchar(60),
	"display_name" varchar(120),
	"bio" text,
	"avatar_url" text,
	"profession" varchar(80),
	"location" varchar(80),
	"link_website" text,
	"link_linkedin" text,
	"link_instagram" text,
	"link_github" text,
	"link_behance" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_scores" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"total_sold" integer DEFAULT 0 NOT NULL,
	"total_cancelled" integer DEFAULT 0 NOT NULL,
	"total_pending" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users_plan" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"plan_type" "user_plan_type" DEFAULT 'free' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD COLUMN "mercado_pago_preference_id" varchar(140);--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD COLUMN "mercado_pago_payment_id" varchar(140);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "share_token_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "share_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signer_name" varchar(140);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signer_document" varchar(40);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signature_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signer_ip" varchar(80);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signer_user_agent" varchar(300);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signature_ciphertext" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signature_iv" varchar(255);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signature_auth_tag" varchar(255);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signature_key_version" varchar(20);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contract_signature_mime_type" varchar(40);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "payment_released_at" timestamp;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "lifecycle_status" "proposal_lifecycle_status" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "public_hash" varchar(120);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pix_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pix_key_type" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provider_signature_ciphertext" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provider_signature_iv" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provider_signature_auth_tag" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provider_signature_updated_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_clause_id_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "public"."clauses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_ratings" ADD CONSTRAINT "contract_ratings_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_ratings" ADD CONSTRAINT "contract_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mercado_pago_accounts" ADD CONSTRAINT "mercado_pago_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_scores" ADD CONSTRAINT "user_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_plan" ADD CONSTRAINT "users_plan_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "user_subscriptions" DROP COLUMN IF EXISTS "id";--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_share_token_hash_unique" UNIQUE("share_token_hash");--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_public_hash_unique" UNIQUE("public_hash");