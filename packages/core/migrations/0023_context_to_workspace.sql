-- Rename the context-versioning audit objects to "workspace".
-- (Hand-written: drizzle-kit generate is blocked by a pre-existing
--  0021/0022 snapshot collision in migrations/meta; these renames are
--  simple and safe to apply directly.)
ALTER TABLE "context_version" RENAME TO "workspace_version";
--> statement-breakpoint
ALTER TABLE "skill_run" RENAME COLUMN "context_sha" TO "workspace_sha";
--> statement-breakpoint
ALTER TABLE "workflow_run" RENAME COLUMN "context_sha" TO "workspace_sha";
--> statement-breakpoint
ALTER TABLE "eval_run" RENAME COLUMN "context_sha" TO "workspace_sha";
