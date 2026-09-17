-- The index behind the Artifacts list: `where visibility = 'user'` ordered by
-- recency, per org. `artifact` is populated, so this builds CONCURRENTLY and
-- lives here rather than in the migration that adds the column
-- (packages/core/migrations/CONVENTIONS.md, rule 1).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "artifact_org_visibility_updated_idx"
  ON "artifact" ("org_id", "visibility", "updated_at" DESC);
