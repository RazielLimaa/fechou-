CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE "public"."checkout_intent_status" AS ENUM(
    'requires_payment_method',
    'payment_pending',
    'processing',
    'paid',
    'failed',
    'expired',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."checkout_intent_flow" AS ENUM(
    'checkout_pro',
    'checkout_bricks',
    'transparent_order',
    'payments_api'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."checkout_intent_resource_type" AS ENUM('proposal', 'contract');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."secure_payment_status" AS ENUM(
    'pending',
    'approved',
    'rejected',
    'cancelled',
    'refunded'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."webhook_event_status" AS ENUM(
    'received',
    'queued',
    'processing',
    'processed',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "checkout_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "resource_type" "checkout_intent_resource_type" NOT NULL,
  "resource_id" integer NOT NULL,
  "proposal_id" integer REFERENCES "proposals"("id") ON DELETE set null,
  "contract_id" integer REFERENCES "contracts"("id") ON DELETE set null,
  "access_scope" varchar(32) NOT NULL DEFAULT 'public_share',
  "flow" "checkout_intent_flow" NOT NULL DEFAULT 'checkout_pro',
  "provider" "payment_provider" NOT NULL DEFAULT 'mercadopago',
  "status" "checkout_intent_status" NOT NULL DEFAULT 'requires_payment_method',
  "amount" numeric(12,2) NOT NULL,
  "currency" varchar(10) NOT NULL DEFAULT 'BRL',
  "description" varchar(255) NOT NULL,
  "external_reference" varchar(180) NOT NULL,
  "share_token_hash" varchar(128),
  "correlation_id" varchar(120) NOT NULL,
  "provider_reference_id" varchar(140),
  "last_provider_payment_id" varchar(140),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_reconciled_at" timestamp,
  "paid_at" timestamp,
  "expires_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_intents_external_reference_unique"
  ON "checkout_intents" ("external_reference");
CREATE INDEX IF NOT EXISTS "checkout_intents_resource_status_idx"
  ON "checkout_intents" ("user_id", "resource_type", "resource_id", "status");
CREATE INDEX IF NOT EXISTS "checkout_intents_share_token_hash_idx"
  ON "checkout_intents" ("share_token_hash");
CREATE INDEX IF NOT EXISTS "checkout_intents_correlation_id_idx"
  ON "checkout_intents" ("correlation_id");

CREATE TABLE IF NOT EXISTS "payment_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "checkout_intent_id" uuid NOT NULL REFERENCES "checkout_intents"("id") ON DELETE cascade,
  "provider" "payment_provider" NOT NULL DEFAULT 'mercadopago',
  "provider_payment_id" varchar(140),
  "provider_preference_id" varchar(140),
  "provider_order_id" varchar(140),
  "idempotency_key" varchar(120) NOT NULL,
  "status" "secure_payment_status" NOT NULL DEFAULT 'pending',
  "status_detail" varchar(180),
  "amount" numeric(12,2) NOT NULL,
  "currency" varchar(10) NOT NULL DEFAULT 'BRL',
  "external_reference" varchar(180),
  "request_id" varchar(180),
  "provider_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_idempotency_key_unique"
  ON "payment_transactions" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_provider_payment_unique"
  ON "payment_transactions" ("provider", "provider_payment_id");
CREATE INDEX IF NOT EXISTS "payment_transactions_provider_preference_idx"
  ON "payment_transactions" ("provider_preference_id");
CREATE INDEX IF NOT EXISTS "payment_transactions_checkout_intent_status_idx"
  ON "payment_transactions" ("checkout_intent_id", "status");

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_key" varchar(200) NOT NULL,
  "provider" "payment_provider" NOT NULL DEFAULT 'mercadopago',
  "topic" varchar(80) NOT NULL,
  "action" varchar(120),
  "data_id" varchar(180) NOT NULL,
  "request_id" varchar(180),
  "ts" varchar(32) NOT NULL,
  "signature_valid" boolean NOT NULL DEFAULT false,
  "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "headers_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" "webhook_event_status" NOT NULL DEFAULT 'received',
  "processing_attempts" integer NOT NULL DEFAULT 0,
  "processing_started_at" timestamp,
  "processed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_event_key_unique"
  ON "webhook_events" ("event_key");
CREATE INDEX IF NOT EXISTS "webhook_events_provider_topic_data_idx"
  ON "webhook_events" ("provider", "topic", "data_id");
CREATE INDEX IF NOT EXISTS "webhook_events_status_created_idx"
  ON "webhook_events" ("status", "created_at");

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_id" integer REFERENCES "users"("id") ON DELETE set null,
  "tenant_id" integer,
  "event_type" varchar(120) NOT NULL,
  "resource_type" varchar(80) NOT NULL,
  "resource_id" varchar(120) NOT NULL,
  "idempotency_key" varchar(120),
  "request_id" varchar(180),
  "correlation_id" varchar(120),
  "ip_address" varchar(80),
  "user_agent" varchar(300),
  "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_logs_resource_idx"
  ON "audit_logs" ("resource_type", "resource_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_request_idx"
  ON "audit_logs" ("request_id");
CREATE INDEX IF NOT EXISTS "audit_logs_correlation_idx"
  ON "audit_logs" ("correlation_id");

CREATE TABLE IF NOT EXISTS "security_idempotency_keys" (
  "idempotency_key" varchar(120) PRIMARY KEY,
  "scope" varchar(80) NOT NULL,
  "user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "request_hash" varchar(128) NOT NULL,
  "resource_type" varchar(80),
  "resource_id" varchar(120),
  "response_json" jsonb,
  "lock_expires_at" timestamp,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "security_idempotency_scope_resource_idx"
  ON "security_idempotency_keys" ("scope", "resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "security_idempotency_expires_at_idx"
  ON "security_idempotency_keys" ("expires_at");
