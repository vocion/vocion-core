-- Hand-written, matching 0066's precedent: drizzle-kit generate is still
-- blocked by the pre-existing snapshot-chain gap (see 0066's header). The
-- PGlite runtime migrator reads this file + meta/_journal.json and applies
-- it cleanly.
--
-- scope_ref: the record a docked conversation is scoped to (CRM mirror ref,
-- e.g. `contacts:9412`); null = everything-scoped. Scoped resume filters on
-- (org_id, scope_ref, created_by) — conversations are per user, never shared.
-- trace_json: the turn's typed activity trace persisted with the message so
-- the transcript's expanded levels survive reload instead of living only in
-- the SSE stream.
ALTER TABLE "conversation" ADD COLUMN "scope_ref" text;--> statement-breakpoint
CREATE INDEX "conversation_org_scope_idx" ON "conversation" USING btree ("org_id","scope_ref","updated_at");--> statement-breakpoint
ALTER TABLE "conversation_message" ADD COLUMN "trace_json" jsonb;
