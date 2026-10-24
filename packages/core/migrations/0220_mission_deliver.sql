-- 8.0.0, ADR 0008: when lives in automations; a mission says where its result
-- goes. Nothing moves on the clock: every schedule this migration touches is
-- pinned to UTC, which is what it already meant. Everything it changes is
-- copied to "migration_0220_backup" first; docs/deploy/migrating-8.md has the
-- rollback.

-- Where a check's result goes when the check finishes (`deliver:`).
ALTER TABLE "mission" ADD COLUMN IF NOT EXISTS "deliver" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "migration_0220_backup" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "migration_0220_backup" ("kind", "org_id", "slug", "data")
SELECT 'automation.when', "org_id", "slug", "when_config" FROM "automation"
WHERE "when_config" ->> 'schedule' IS NOT NULL AND "when_config" ->> 'timezone' IS NULL;
--> statement-breakpoint
INSERT INTO "migration_0220_backup" ("kind", "org_id", "slug", "data")
SELECT 'mission.schedule', m."org_id", m."slug", jsonb_build_object('schedule', m."schedule") FROM "mission" m
WHERE m."schedule" IS NOT NULL
	-- migrate.sh replays every file on every deploy: back each one up once.
	AND NOT EXISTS (SELECT 1 FROM "migration_0220_backup" b WHERE b."kind" = 'mission.schedule' AND b."org_id" = m."org_id" AND b."slug" = m."slug");
--> statement-breakpoint
-- A schedule that names no zone was read in UTC; 8.0 says so.
UPDATE "automation" SET "when_config" = "when_config" || '{"timezone":"UTC"}'::jsonb
WHERE "when_config" ->> 'schedule' IS NOT NULL AND "when_config" ->> 'timezone' IS NULL;
--> statement-breakpoint
-- A mission's own cron becomes the automation <slug>-check, as the loader
-- does for a version-1 manifest — unless an active automation already checks
-- the mission on a schedule (the two fired every tick), or the slug is taken.
INSERT INTO "automation" ("org_id", "project_id", "slug", "name", "description", "status", "when_config", "do_config", "owner_agent_slug")
SELECT m."org_id", m."project_id", m."slug" || '-check', m."name" || ' (scheduled check)',
	'Moved from the mission''s schedule: in 8.0.0 (migration 0220).',
	CASE WHEN m."status" = 'active' THEN 'active' ELSE 'disabled' END,
	jsonb_build_object('schedule', m."schedule", 'timezone', 'UTC'),
	jsonb_build_object('checkMission', m."slug"),
	m."agent_slug"
FROM "mission" m
WHERE m."schedule" IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM "automation" a
		WHERE a."org_id" = m."org_id" AND a."do_config" ->> 'checkMission' = m."slug"
			AND a."when_config" ->> 'schedule' IS NOT NULL AND a."status" = 'active'
	)
	AND NOT EXISTS (SELECT 1 FROM "automation" a WHERE a."org_id" = m."org_id" AND a."slug" = m."slug" || '-check')
ON CONFLICT DO NOTHING;
