-- Hand-written, per 0066/0067's precedent (the snapshot chain predates them).
--
-- The comment layer: notes anchored to a span of a document, stored BESIDE
-- the document. The anchor is content-addressed (quote + surrounding text),
-- not a DOM offset, so a re-render or an edit elsewhere cannot misplace a
-- highlight; an unfindable quote resolves as orphaned rather than wrong.
CREATE TABLE "anchored_comment" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"target_ref" text NOT NULL,
	"field" text NOT NULL,
	"anchor" jsonb NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text,
	"applied_at" timestamp,
	"applied_by_run_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "anchored_comment_org_target_idx" ON "anchored_comment" USING btree ("org_id","target_ref","status");
