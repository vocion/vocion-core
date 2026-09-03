-- Hand-written, not `drizzle-kit generate`-produced: generation is currently
-- blocked by a pre-existing gap between the migration count (67 .sql files)
-- and the snapshot history (only 23 meta/*.json snapshots, plus a stale
-- 0021/0022 snapshot-id collision). Both predate this migration and
-- reproduce on an unmodified checkout. The PGlite runtime migrator only
-- reads this file + meta/_journal.json, so it applies cleanly regardless;
-- fixing the snapshot chain itself is separate, larger repo-debt work.
CREATE TABLE "chat_widget_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_slug" text NOT NULL,
	"conversation_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_widget_state" ADD CONSTRAINT "chat_widget_state_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_widget_state_org_user_idx" ON "chat_widget_state" USING btree ("org_id","user_id");
