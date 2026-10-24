-- Jev judges duplicates (ADR 0007). `project.jev` is which decisions a
-- workspace lets Jev make (`defaults.jev` in workspace.yaml; NULL is none), and
-- `record_duplicate_check` keeps every check such a workspace ran: one row per
-- judge asked (exact match, Jev, the classifier), with a hash of what was
-- asked, never a key or the record's text. A workspace that has not opted in
-- writes nothing here.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "jev" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "record_duplicate_check" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" integer NOT NULL,
	"judge" text NOT NULL,
	"verdict" text NOT NULL,
	"duplicate_of" integer,
	"confidence" double precision,
	"candidates" integer NOT NULL,
	"inputs_hash" text NOT NULL,
	"latency_ms" integer,
	"model" text,
	"key_scope" text,
	"provider" text,
	"input_tokens" integer,
	"fallback" text,
	"linked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_duplicate_check_org_created_idx" ON "record_duplicate_check" USING btree ("org_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_duplicate_check_object_idx" ON "record_duplicate_check" USING btree ("org_id","object_id");
