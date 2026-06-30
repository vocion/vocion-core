-- Tenant API tokens — the control-plane credential (vcn_live_<id>_<secret>).
CREATE TABLE IF NOT EXISTS "api_token" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "secret_hash" text NOT NULL,
  "role" text DEFAULT 'owner' NOT NULL,
  "grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp,
  "revoked_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_token_org_idx" ON "api_token" ("org_id");
