CREATE TABLE IF NOT EXISTS "password_reset_challenges" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "code_hash" varchar(128) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "requested_ip" varchar(80),
  "requested_user_agent" text,
  "verified_ip" varchar(80),
  "verified_user_agent" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "password_reset_challenges"
 ADD CONSTRAINT "password_reset_challenges_user_id_users_id_fk"
 FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prc_user_id" ON "password_reset_challenges" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prc_code_hash" ON "password_reset_challenges" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prc_expires_at" ON "password_reset_challenges" USING btree ("expires_at");
