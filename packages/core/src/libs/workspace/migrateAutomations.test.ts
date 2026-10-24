import type { MigrationEdit } from './migrateAutomations';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { localizeCron, planMigration } from './migrateAutomations';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'migrate-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

function apply(edits: MigrationEdit[]): void {
  for (const e of edits) {
    if (e.after === null) {
      unlinkSync(e.path);
    } else {
      mkdirSync(dirname(e.path), { recursive: true });
      writeFileSync(e.path, e.after);
    }
  }
}

const KESTREL = {
  'workspace.yaml': 'version: 1\norgId: org_kestrel\nname: Kestrel\ndefaults:\n  timezone: America/Los_Angeles\n',
  'missions/weekly-review.yaml': 'slug: weekly-review\nname: Weekly review\ngoal: >-\n  Every Friday, a read on the week that a person can act on in two minutes,\n  folded over two lines so a re-serializer would re-fold it.\nagent: kestrel-lead\nschedule: \'0 15 * * 5\'\n',
  'missions/daily-brief.yaml': 'slug: daily-brief\nname: Daily brief\ngoal: The morning read.\nagent: kestrel-lead\nschedule: \'0 13 * * 1-5\'\n',
  'automations/morning-brief.yaml': '# Weekday mornings.\nslug: morning-brief\nagent: kestrel-lead\nwhen:\n  schedule: \'0 13 * * 1-5\' # 13:00 UTC\ndo:\n  checkMission: daily-brief\n',
  'automations/morning-brief-email.yaml': 'slug: morning-brief-email\nagent: kestrel-lead\nwhen:\n  schedule: \'20 13 * * 1-5\'\ndo:\n  job: daily-team-report\n  input:\n    hours: 24\n    briefing:\n      agentSlug: kestrel-lead\n',
  'automations/on-reply.yaml': 'slug: on-reply\nwhen:\n  event: prospect.reply\ndo:\n  checkMission: daily-brief\n',
};

describe('migrate:automations (ADR 0008)', () => {
  it('moves a version-1 workspace to the 8.0 form without moving anything on the clock', () => {
    const dir = folder(KESTREL);
    const plan = planMigration(dir);
    apply(plan.edits);
    const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

    expect(read('workspace.yaml')).toContain('version: 2\n');
    // Pinned to what it always meant, comment kept.
    expect(read('automations/morning-brief.yaml')).toContain('  schedule: \'0 13 * * 1-5\' # 13:00 UTC\n  timezone: UTC\n');
    // A mission cron with no automation becomes one; a long folded goal is untouched.
    expect(read('automations/weekly-review-check.yaml')).toContain('when:\n  schedule: \'0 15 * * 5\'\n  timezone: UTC\ndo:\n  checkMission: weekly-review\n');
    expect(read('missions/weekly-review.yaml')).toBe(KESTREL['missions/weekly-review.yaml'].replace('schedule: \'0 15 * * 5\'\n', ''));
    // A mission cron an automation already kept was the second fire: removed.
    expect(read('missions/daily-brief.yaml')).not.toContain('schedule:');
    // The mail timed after the check is the mission's delivery now.
    expect(read('missions/daily-brief.yaml')).toContain('deliver:\n  email: true\n');
    expect(() => read('automations/morning-brief-email.yaml')).toThrow();
    expect(read('automations/on-reply.yaml')).toBe(KESTREL['automations/on-reply.yaml']);
    expect(plan.notes.join('\n')).toContain('already checks it on a schedule (both fired)');
  });

  it('plans nothing the second time', () => {
    const dir = folder(KESTREL);
    apply(planMigration(dir).edits);

    expect(planMigration(dir)).toEqual({ edits: [], notes: [] });
  });

  it('leaves a mail it cannot match to one check, and says so', () => {
    const dir = folder({
      'automations/report-email.yaml': 'slug: report-email\nwhen:\n  schedule: \'30 13 * * *\'\n  timezone: UTC\ndo:\n  job: daily-team-report\n  input:\n    briefing:\n      teamSlug: ops\n',
    });
    const plan = planMigration(dir);

    expect(plan.edits).toEqual([]);
    expect(plan.notes[0]).toContain('no mission check runs before it');
  });

  it('gives a workspace\'s changed cadence on a plugin mission its own copy of the plugin\'s automation', () => {
    const dir = folder({
      'workspace.yaml': 'version: 2\norgId: o\nname: n\n',
      'missions/rooms-current.yaml': 'slug: rooms-current\nextends: core\nschedule: \'0 16 * * 1-5\'\n',
    });
    const plugin = 'slug: rooms-daily-check\nagent: room-keeper\nwhen:\n  schedule: \'0 14 * * 1-5\'\n  timezone: UTC\ndo:\n  checkMission: rooms-current\n';
    const plan = planMigration(dir, { foreign: [{ slug: 'rooms-daily-check', schedule: '0 14 * * 1-5', checkMission: 'rooms-current', active: true, text: plugin }] });
    const copy = plan.edits.find(e => e.path.endsWith('automations/rooms-daily-check.yaml'));

    expect(copy?.after).toContain('  schedule: \'0 16 * * 1-5\'\n  timezone: UTC\n');
    expect(plan.edits.find(e => e.path.endsWith('missions/rooms-current.yaml'))?.after).toBe('slug: rooms-current\nextends: core\n');
  });
});

describe('localizeCron', () => {
  it('moves a simple UTC cron onto the zone\'s clock at the given offset', () => {
    expect(localizeCron('0 13 * * 1-5', 'America/Los_Angeles', new Date('2026-10-24T12:00:00Z'))).toBe('0 6 * * 1-5');
    expect(localizeCron('30 13,17 * * 1-5', 'America/New_York', new Date('2026-12-01T12:00:00Z'))).toBe('30 8,12 * * 1-5');
  });

  it('refuses a cron the shift would carry across midnight, a step, or a half-hour zone', () => {
    expect(localizeCron('0 2 * * 1-5', 'America/Los_Angeles', new Date('2026-10-24T12:00:00Z'))).toBeNull();
    expect(localizeCron('0 */2 * * *', 'America/Los_Angeles', new Date('2026-10-24T12:00:00Z'))).toBeNull();
    expect(localizeCron('0 13 * * *', 'Asia/Kolkata', new Date('2026-10-24T12:00:00Z'))).toBeNull();
  });
});
