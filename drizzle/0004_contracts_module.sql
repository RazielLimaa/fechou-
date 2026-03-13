CREATE TYPE "public"."contract_status" AS ENUM('draft', 'editing', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."user_plan_type" AS ENUM('free', 'pro', 'premium');--> statement-breakpoint

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
  "status" "contract_status" DEFAULT 'draft' NOT NULL,
  "template_id" integer,
  "layout_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "clauses" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" varchar(180) NOT NULL,
  "content" text NOT NULL,
  "category" varchar(100) NOT NULL,
  "profession" varchar(80),
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "contract_clauses" (
  "id" serial PRIMARY KEY NOT NULL,
  "contract_id" integer NOT NULL,
  "clause_id" integer NOT NULL,
  "custom_content" text,
  "order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "users_plan" (
  "user_id" integer PRIMARY KEY NOT NULL,
  "plan_type" "user_plan_type" DEFAULT 'free' NOT NULL
);
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
 ALTER TABLE "users_plan" ADD CONSTRAINT "users_plan_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
