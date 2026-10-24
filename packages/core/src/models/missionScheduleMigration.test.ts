import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Migration 0220 (8.0.0, ADR 0008) against the schedules that exist. Nothing
 * may move on the clock, every row it changes is backed up first, and because
 * `infra/aws/migrate.sh` replays every file on every deploy, a second run must
 * change nothing.
 */

const MIGRATION_SQL = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations/0220_mission_deliver.sql'),
  'utf8',
);

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE "mission" ("id" serial PRIMARY KEY, "org_id" text NOT NULL, "project_id" text, "slug" text NOT NULL, "name" text NOT NULL, "status" text DEFAULT 'active', "agent_slug" text NOT NULL, "schedule" text);
    CREATE TABLE "automation" ("id" serial PRIMARY KEY, "org_id" text NOT NULL, "project_id" text, "slug" text NOT NULL, "name" text NOT NULL, "description" text, "status" text DEFAULT 'active', "when_config" jsonb NOT NULL, "do_config" jsonb NOT NULL, "owner_agent_slug" text);
    CREATE UNIQUE INDEX "automation_org_slug_idx" ON "automation" ("org_id", "slug");
    INSERT INTO "mission" ("org_id", "slug", "name", "agent_slug", "schedule") VALUES
      ('org_kestrel', 'weekly-review', 'Weekly review', 'kestrel-lead', '0 15 * * 5'),
      ('org_kestrel', 'rooms-current', 'Rooms current', 'room-keeper', '0 14 * * 1-5'),
      ('org_kestrel', 'no-cadence', 'No cadence', 'kestrel-lead', NULL);
    INSERT INTO "automation" ("org_id", "slug", "name", "when_config", "do_config") VALUES
      ('org_kestrel', 'rooms-daily-check', 'Rooms', '{"schedule":"0 14 * * 1-5"}', '{"checkMission":"rooms-current"}'),
      ('org_kestrel', 'on-reply', 'On reply', '{"event":"prospect.reply"}', '{"checkMission":"weekly-review"}'),
      ('org_kestrel', 'local', 'Local', '{"schedule":"30 6 * * 1-5","timezone":"America/Los_Angeles"}', '{"job":"ads-guard"}');
  `);
});

afterEach(async () => {
  await db.close();
});

async function automations(): Promise<Array<{ slug: string; when: unknown; description: string | null }>> {
  const r = await db.query<{ slug: string; when_config: unknown; description: string | null }>(`SELECT "slug", "when_config", "description" FROM "automation" ORDER BY "slug"`);
  return r.rows.map(row => ({ slug: row.slug, when: row.when_config, description: row.description }));
}

describe('migration 0220: when lives in automations', () => {
  it('pins every unzoned schedule to UTC, moves a mission cron to <slug>-check, and never doubles one an automation keeps', async () => {
    await db.exec(MIGRATION_SQL);

    expect(await automations()).toEqual([
      { slug: 'local', when: { schedule: '30 6 * * 1-5', timezone: 'America/Los_Angeles' }, description: null },
      { slug: 'on-reply', when: { event: 'prospect.reply' }, description: null },
      { slug: 'rooms-daily-check', when: { schedule: '0 14 * * 1-5', timezone: 'UTC' }, description: null },
      { slug: 'weekly-review-check', when: { schedule: '0 15 * * 5', timezone: 'UTC' }, description: 'Moved from the mission\'s schedule: in 8.0.0 (migration 0220).' },
    ]);
  });

  it('backs up what it changed, once, and a replay changes nothing', async () => {
    await db.exec(MIGRATION_SQL);
    const first = await automations();
    await db.exec(MIGRATION_SQL);

    expect(await automations()).toEqual(first);

    const backup = await db.query<{ kind: string; slug: string; data: unknown }>(`SELECT "kind", "slug", "data" FROM "migration_0220_backup" ORDER BY "kind", "slug"`);

    expect(backup.rows).toEqual([
      { kind: 'automation.when', slug: 'rooms-daily-check', data: { schedule: '0 14 * * 1-5' } },
      { kind: 'mission.schedule', slug: 'rooms-current', data: { schedule: '0 14 * * 1-5' } },
      { kind: 'mission.schedule', slug: 'weekly-review', data: { schedule: '0 15 * * 5' } },
    ]);
  });

  it('adds mission.deliver', async () => {
    await db.exec(MIGRATION_SQL);
    const cols = await db.query<{ column_name: string }>(`SELECT "column_name" FROM information_schema.columns WHERE "table_name" = 'mission' AND "column_name" = 'deliver'`);

    expect(cols.rows).toHaveLength(1);
  });
});
