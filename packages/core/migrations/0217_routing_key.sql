-- Dynamic routing with Jev (ADR 0006).
--
-- `routing_key` holds the OpenRouter key that turns it on: one row for the
-- installation (`holder = 'instance'`) and at most one per workspace
-- (`holder = 'workspace:<orgId>'`). Encrypted with the credential vault, the
-- same AES-256-GCM columns `user_mfa` and `api_token` use; only the last four
-- characters are kept in the clear. No row and no `VOCION_JEV_API_KEY` means
-- routing is exactly the static chain of ADR 0005 and Jev is never called.
--
-- `engine_run.route_selector` / `route_detail` record who chose each run's
-- engine, model and effort, and what Jev answered. Nullable, no default: a
-- metadata change on an existing table, no rewrite and no index.
CREATE TABLE IF NOT EXISTS "routing_key" (
  "holder" text PRIMARY KEY NOT NULL,
  "org_id" text,
  "dek_id" integer NOT NULL REFERENCES "source_dek"("id") ON DELETE restrict,
  "ciphertext" text NOT NULL,
  "nonce" text NOT NULL,
  "auth_tag" text NOT NULL,
  "key_hint" text NOT NULL,
  "set_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engine_run" ADD COLUMN IF NOT EXISTS "route_selector" text;
--> statement-breakpoint
ALTER TABLE "engine_run" ADD COLUMN IF NOT EXISTS "route_detail" jsonb;
