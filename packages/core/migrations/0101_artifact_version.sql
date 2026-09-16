-- 0101 — artifacts become single, live and versioned.
--
-- 0095 modelled what an agent rendered as an `artifact` row placed on a tile
-- grid (`canvas`). Product moved the same day (Chris, 2026-09-15): one
-- artifact open beside the conversation, edited in place by the person AND
-- the agent, every edit a version, with a browsable log of all of them —
-- the Claude.ai / Cloudflare artifact model, not a configurable dashboard.
--
-- This migration adds the version history and the log's metadata:
--
--   artifact_version  one immutable row per edit: the title + spec as of that
--                     version, who made it (`agent` | `human` | `system`),
--                     which run/message it came from, and a one-line change
--                     summary. Restoring an old version writes a NEW head
--                     version — history is never rewritten.
--   artifact.current_version / head_version_id  the head pointer.
--   artifact.folder                             path-like grouping for the log
--                                               (e.g. `revenue/weekly`).
--   artifact.last_author_kind / last_author_id  denormalised head author, so
--                                               the log lists "last editor"
--                                               without a join per row.
--
-- The backfill gives every existing artifact a v1 authored by whoever
-- `created_by` names (an `agent:<slug>` prefix means the agent wrote it).
--
-- `canvas` is now UNUSED: nothing in the app reads or writes it as of this
-- migration. It is left in place deliberately — dropping a table is a
-- contract step, not an expand step (CONVENTIONS.md rule 2) — and is slated
-- for DROP in a later release. `artifact.canvas_id`, `artifact.tile` and
-- `artifact.pinned` go the same way; they keep their defaults so inserts
-- from either half of a rolling deploy still work.
--
-- artifact_version is created here, so its indexes are declared inline
-- (CONVENTIONS.md rule 1 applies only to pre-existing tables). The one index
-- this adds to the populated `artifact` table is a concurrent build in
-- `concurrent/0101_artifact_org_updated_index.sql`.
CREATE TABLE IF NOT EXISTS "artifact_version" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "artifact_id" integer NOT NULL REFERENCES "artifact"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "author_kind" text DEFAULT 'agent' NOT NULL,
  "author_id" text,
  "run_id" text,
  "message_id" integer,
  "change_summary" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artifact_version_artifact_version_idx" ON "artifact_version" ("artifact_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_version_org_artifact_idx" ON "artifact_version" ("org_id", "artifact_id", "created_at");
--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN IF NOT EXISTS "current_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN IF NOT EXISTS "head_version_id" integer;
--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN IF NOT EXISTS "folder" text;
--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN IF NOT EXISTS "last_author_kind" text DEFAULT 'agent' NOT NULL;
--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN IF NOT EXISTS "last_author_id" text;
--> statement-breakpoint
-- Backfill: one v1 per existing artifact, attributed from `created_by`.
INSERT INTO "artifact_version" ("org_id", "artifact_id", "version", "kind", "title", "spec", "author_kind", "author_id", "message_id", "change_summary", "created_at")
SELECT a."org_id", a."id", 1, a."kind", a."title", a."spec",
       CASE WHEN a."created_by" LIKE 'agent:%' THEN 'agent' WHEN a."created_by" IS NULL THEN 'system' ELSE 'human' END,
       a."created_by", a."message_id", 'Created', a."created_at"
FROM "artifact" a
WHERE NOT EXISTS (SELECT 1 FROM "artifact_version" v WHERE v."artifact_id" = a."id");
--> statement-breakpoint
UPDATE "artifact" a
SET "head_version_id" = v."id",
    "last_author_kind" = v."author_kind",
    "last_author_id" = v."author_id"
FROM "artifact_version" v
WHERE v."artifact_id" = a."id" AND v."version" = a."current_version" AND a."head_version_id" IS NULL;
--> statement-breakpoint
COMMENT ON TABLE "artifact_version" IS 'One immutable row per artifact edit: title + spec as of that version, author kind (agent|human|system), the run/message it came from, and a change summary. Restore writes a new head version; history is never rewritten.';
--> statement-breakpoint
COMMENT ON COLUMN "artifact"."folder" IS 'Optional path-like grouping for the artifacts log, e.g. revenue/weekly. Flat text, not a tree.';
--> statement-breakpoint
COMMENT ON COLUMN "artifact"."current_version" IS 'Head version number; artifact.title/spec always mirror the head artifact_version row.';
--> statement-breakpoint
COMMENT ON TABLE "canvas" IS 'UNUSED as of migration 0101 — the tile grid was replaced by one live, versioned artifact beside the conversation. Nothing reads or writes this table; slated for DROP in a later release. artifact.canvas_id / tile / pinned are dead for the same reason.';
