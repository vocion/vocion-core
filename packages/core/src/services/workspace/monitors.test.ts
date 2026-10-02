/**
 * What is watched and what each check saw, read from `automation` and
 * `automation_run` on PGlite. Every name is invented.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema } = await import('@/models/Schema');
const { loadCheckLog, loadMonitors, monitorSlugs } = await import('./monitors');

const ORG = 'org_monitors';
const NOW = new Date('2026-01-10T12:10:00Z');
const check = (outcome: string, summary: string) => ({ acted: [], check: { kind: 'Sentry issues', threshold: '20 events', outcome, at: NOW.toISOString(), targets: [{ label: 'northwind-api', outcome, summary, observed: {} }] } });

describe('monitors and their checks', () => {
  it('lists each named monitor with its schedule, state, targets and last check, and logs its runs newest first', async () => {
    await db.insert(automationSchema).values([
      { orgId: ORG, slug: 'error-watch', name: 'Production errors become incidents', whenConfig: { schedule: '*/10 * * * *' }, doConfig: { job: 'error-watch' } },
      { orgId: ORG, slug: 'site-health', name: 'Sites answer', whenConfig: { schedule: '*/10 * * * *' }, doConfig: { job: 'site-health' }, pausedAt: new Date('2026-01-10T11:00:00Z'), pausedBy: 'user_1', pausedNote: 'moving DNS' },
    ]);
    await db.insert(automationRunSchema).values([
      { orgId: ORG, slug: 'error-watch', kind: 'job', status: 'ok', result: check('opened', '2 issues; NW-API-3 at 184 events: opened: deploy'), startedAt: new Date('2026-01-10T11:50:00Z') },
      { orgId: ORG, slug: 'error-watch', kind: 'job', status: 'ok', result: check('quiet', 'no errors in the last hour'), startedAt: new Date('2026-01-10T12:00:00Z') },
      { orgId: ORG, slug: 'error-watch', kind: 'job', status: 'error', error: 'Sentry answered 401', startedAt: new Date('2026-01-10T11:40:00Z') },
      { orgId: ORG, slug: 'error-watch', kind: 'job', status: 'ok', result: { acted: [] }, startedAt: new Date('2026-01-10T11:30:00Z') },
      // A person's pause and a dry run are not checks.
      { orgId: ORG, slug: 'error-watch', kind: 'control', status: 'ok', startedAt: new Date('2026-01-10T12:05:00Z') },
      { orgId: ORG, slug: 'error-watch', kind: 'job', status: 'ok', dryRun: true, result: check('quiet', 'x'), startedAt: new Date('2026-01-10T12:06:00Z') },
      // Older than a day: not counted in the day, still in the log's past.
      { orgId: ORG, slug: 'error-watch', kind: 'job', status: 'ok', result: check('quiet', 'old'), startedAt: new Date('2026-01-08T12:00:00Z') },
    ]);

    expect(await monitorSlugs(ORG, { automations: ['error-watch'] }, null)).toEqual(['error-watch']);

    const [watch, health, ...rest] = await loadMonitors(ORG, ['error-watch', 'site-health', 'not-here'], NOW);

    expect(rest).toEqual([]);
    expect(watch).toMatchObject({ slug: 'error-watch', every: expect.stringMatching(/10 minutes/), state: 'active', pause: null, targets: ['northwind-api'], kind: 'Sentry issues', lastCheck: { outcome: 'quiet', line: 'northwind-api: no errors in the last hour', failed: false }, day: { checks: 4, opened: 1 } });
    expect(health).toMatchObject({ slug: 'site-health', state: 'paused', pause: { byName: 'user_1', note: 'moving DNS' }, targets: [], lastCheck: null, day: { checks: 0, opened: 0 } });

    const log = await loadCheckLog(ORG, ['error-watch'], 4);

    expect(log.map(r => [r.outcome, r.line])).toEqual([
      ['quiet', 'northwind-api: no errors in the last hour'],
      ['opened', 'northwind-api: 2 issues; NW-API-3 at 184 events: opened: deploy'],
      ['unchecked', 'Failed: Sentry answered 401'],
      [null, 'Ran; this run did not record what it saw'],
    ]);
    expect(log[0]!.monitor).toBe('Production errors become incidents');
  });
});
