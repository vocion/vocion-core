-- Voice rules on the workspace (project) row.
--
-- The workspace's banned constructions, authored as `workspace/<org>/voice.yaml`
-- and applied here by `workspace:apply`. Read by `libs/writing/loadVoiceRules.ts`,
-- merged over core's platform floor, and enforced by `lintCopy` at every seam
-- that produces outbound copy.
--
-- Nullable with no default and no index: a plain ADD COLUMN, safe on a live
-- table. NULL means the workspace has authored none and inherits the floor.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "voice_rules" jsonb;
