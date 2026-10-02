-- Workspace onboarding (#1028): when the first-run setup conversation was
-- opened, and by whom. Auto-open fires only while started_at is null, so it
-- opens once per workspace. Everything else setup reports is read from rows
-- that already exist (the description, sources, enabled plugins).
--
-- Numbered 0165 rather than 0161: main claimed 0161-0164 first, so this
-- renumbered to the tail per CONVENTIONS rule 5. It had not merged, so there
-- is no applied copy anywhere under the old number.
--
-- Backfill: every workspace that exists when this ships counts as started, so
-- a mature workspace (RevOps, a factory) does not pop a setup conversation on
-- its first admin visit after the deploy. "Onboard this workspace" in chat
-- still works there. started_by = 'backfill:0165' marks those rows, so a report
-- on time-to-first-source can leave them out.
--
-- The backfill runs only in the same step that adds the column.
-- `infra/aws/migrate.sh` replays every .sql on every deploy, so an UPDATE that
-- ran each time would mark each new workspace as started before anyone opened
-- it.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "onboarding_started_by" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'project'
      AND column_name = 'onboarding_started_at'
  ) THEN
    ALTER TABLE "project" ADD COLUMN "onboarding_started_at" timestamp;
    UPDATE "project" SET "onboarding_started_at" = now(), "onboarding_started_by" = 'backfill:0165';
  END IF;
END $$;
