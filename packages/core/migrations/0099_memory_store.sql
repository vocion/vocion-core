-- 0099 — scoped memory, expand step (plan: "Scoped agent memory on the
-- LangGraph Store", Phase 1). Creates the store and copies every live rule
-- into it; nothing is dropped here — 0100 is the contract step, so a reader
-- can verify the copy between the two.
--
-- memory_namespace: the whitelist of memory buckets (successor of
--   learning_step). Every existing step migrates at workspace scope with
--   path 'workspace/<name>'.
-- memory: the generic LangGraph BaseStore backing table. One row per item;
--   rules are FileData-shaped values keyed by their ROUTE-RELATIVE file path
--   '/workspace/<step>/r<learning id>.md' (CompositeBackend strips the
--   /memories mount prefix before the store sees a path), with the EXACT rule text
--   as content (byte-for-byte) and provenance under value.meta.
-- learning_feedback_occurrence.memory_key / learning_candidate
--   .created_memory_key: the store references that replace the integer
--   learning back-links, backfilled from the same ids the copy used.
--
-- New tables build their indexes here (CONVENTIONS.md rule 1 only forbids
-- CREATE INDEX on a populated table); the occurrence index moves to
-- concurrent/0099. All copies are idempotent (ON CONFLICT DO NOTHING /
-- WHERE ... IS NULL) so a re-run cannot double anything.
CREATE TABLE IF NOT EXISTS "memory_namespace" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "scope_kind" text DEFAULT 'workspace' NOT NULL,
  "scope_ref" text,
  "path" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "preamble" text,
  "agent_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_namespace_org_name_idx" ON "memory_namespace" ("org_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_namespace_org_path_idx" ON "memory_namespace" ("org_id", "path");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "namespace" text[] NOT NULL,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "expires_at" timestamp,
  "last_used_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_org_ns_key_idx" ON "memory" ("org_id", "namespace", "key");
--> statement-breakpoint
INSERT INTO "memory_namespace" ("org_id", "name", "scope_kind", "scope_ref", "path", "title", "description", "preamble", "agent_slugs", "created_at")
SELECT s."org_id", s."name", 'workspace', NULL, 'workspace/' || s."name", s."title", s."description", s."preamble", s."agent_slugs", s."created_at"
FROM "learning_step" s
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "memory" ("org_id", "namespace", "key", "value", "last_used_at", "created_at")
SELECT
  l."org_id",
  ARRAY['memories'],
  '/workspace/' || s."name" || '/r' || l."id" || '.md',
  jsonb_build_object(
    'content', l."rule_text",
    'mimeType', 'text/markdown',
    'created_at', to_char(l."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'modified_at', to_char(l."updated_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'meta', jsonb_build_object(
      'kind', 'rule',
      'source', l."source",
      'createdBy', l."created_by",
      'occurrenceCount', l."occurrence_count",
      'adoptedAt', to_char(l."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  ),
  l."last_used_at",
  l."created_at"
FROM "learning" l
JOIN "learning_step" s ON s."id" = l."step_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "learning_feedback_occurrence" ADD COLUMN IF NOT EXISTS "memory_key" text;
--> statement-breakpoint
ALTER TABLE "learning_candidate" ADD COLUMN IF NOT EXISTS "created_memory_key" text;
--> statement-breakpoint
UPDATE "learning_feedback_occurrence" o
SET "memory_key" = '/workspace/' || s."name" || '/r' || l."id" || '.md'
FROM "learning" l
JOIN "learning_step" s ON s."id" = l."step_id"
WHERE o."learning_id" = l."id" AND o."memory_key" IS NULL;
--> statement-breakpoint
UPDATE "learning_candidate" c
SET "created_memory_key" = '/workspace/' || s."name" || '/r' || l."id" || '.md'
FROM "learning" l
JOIN "learning_step" s ON s."id" = l."step_id"
WHERE c."created_learning_id" = l."id" AND c."created_memory_key" IS NULL;
