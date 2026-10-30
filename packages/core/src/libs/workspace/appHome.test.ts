import type { AppHomeMeasure } from './schemas';
import type { PageRow } from '@/libs/workspace/pageFields';
import { describe, expect, it } from 'vitest';
import { ICONS_BY_NAME } from '@/features/dashboard/iconByName';
import { actionMatches, formatFigure, measureHref, projectsUsingApp, readApprovalsMeasure, readMissionMeasure, readProjectMeasure, readRecordsMeasure, readStateMeasure, recordTypesOf } from './appHome';
import { askHref, firstNameOf, firstTile, greetingPart, tileHref } from './appHomeLinks';
import { listApps, loadApp } from './apps';
import { AppHomeMeasureSchema, AppHomeSchema, AppLaunchTileSchema, AppManifestSchema } from './schemas';

// The app home: its manifest schema, the figures it reads, and the shipped
// homes. Fictional records throughout.

const NOW = new Date('2026-10-30T15:00:00Z');

function row(id: number, meta: Record<string, unknown>, over: Partial<PageRow> = {}): PageRow {
  return { id, title: `Row ${id}`, status: null, createdAt: new Date('2026-10-01T00:00:00Z'), meta, ...over };
}

function measure(m: Record<string, unknown>): AppHomeMeasure {
  return AppHomeMeasureSchema.parse({ key: 'm', label: 'Measure', ...m });
}

const project = row(7, { seoCadence: { pagesPerMonth: 8 } }, { title: 'Northwind Outfitters' });

describe('AppLaunchTileSchema', () => {
  const tile = { title: 'Audit a site', description: 'Check a client site and get a report.', icon: 'list-checks' };

  it('takes a tile that does exactly one thing', () => {
    for (const action of [{ ask: 'Audit a site.' }, { prompt: 'Onboard: ' }, { href: '/dashboard/p/seo' }, { workflow: 'seo-plan' }]) {
      expect(AppLaunchTileSchema.safeParse({ ...tile, ...action }).success, JSON.stringify(action)).toBe(true);
    }
  });

  it('refuses a tile with no action, or two', () => {
    expect(AppLaunchTileSchema.safeParse(tile).success).toBe(false);
    expect(AppLaunchTileSchema.safeParse({ ...tile, ask: 'Audit.', href: '/dashboard/p/seo' }).success).toBe(false);
  });

  it('takes a dropped file only on a tile that leaves its words in the composer', () => {
    expect(AppLaunchTileSchema.safeParse({ ...tile, prompt: 'Track prompts: ', accepts: ['.csv'] }).success).toBe(true);
    expect(AppLaunchTileSchema.safeParse({ ...tile, ask: 'Track prompts.', accepts: ['.csv'] }).success).toBe(false);
    expect(AppLaunchTileSchema.safeParse({ ...tile, prompt: 'Track: ', accepts: ['csv'] }).success).toBe(false);
  });

  it('refuses a link that is not a path in the app', () => {
    expect(AppLaunchTileSchema.safeParse({ ...tile, href: 'https://example.com' }).success).toBe(false);
  });
});

describe('AppHomeSchema', () => {
  const launch = [{ title: 'Ask', description: 'Ask the team.', icon: 'search', ask: 'Hello there.' }];

  it('needs one to six tiles, at most one of them first', () => {
    expect(AppHomeSchema.safeParse({ launch: [] }).success).toBe(false);
    expect(AppHomeSchema.safeParse({ launch: Array.from({ length: 7 }, (_, i) => ({ ...launch[0], title: `Tile ${i}` })) }).success).toBe(false);
    expect(AppHomeSchema.safeParse({ launch: [{ ...launch[0], first: true }, { ...launch[0], title: 'Two', first: true }] }).success).toBe(false);
  });

  it('keeps whole-workspace reads off a project block, and project fields off the workspace', () => {
    expect(AppHomeSchema.safeParse({ launch, projects: { measures: [{ key: 'q', label: 'Quiet', source: 'state', view: 'stale-deals' }] } }).success).toBe(false);
    expect(AppHomeSchema.safeParse({ launch, measures: [{ key: 's', label: 'Stage', source: 'project', field: 'meta.stage' }] }).success).toBe(false);
  });

  it('holds each measure kind to what it needs', () => {
    expect(AppHomeMeasureSchema.safeParse({ key: 'a', label: 'A', source: 'records' }).success).toBe(false);
    expect(AppHomeMeasureSchema.safeParse({ key: 'a', label: 'A', source: 'records', objectType: 'seo_page', stat: 'sum' }).success).toBe(false);
    expect(AppHomeMeasureSchema.safeParse({ key: 'a', label: 'A', source: 'state' }).success).toBe(false);
    expect(AppHomeMeasureSchema.safeParse({ key: 'a', label: 'A', source: 'state', view: 'x', query: { sets: ['crm.deal'] } }).success).toBe(false);
    expect(AppHomeMeasureSchema.safeParse({ key: 'a', label: 'A', source: 'approvals' }).success).toBe(false);
    expect(AppHomeMeasureSchema.safeParse({ key: 'a', label: 'A', source: 'mission' }).success).toBe(false);
    expect(AppHomeMeasureSchema.safeParse({ key: 'a', label: 'A', source: 'records', objectType: 'seo_page', where: { field: 'meta.at', op: 'since', value: 'yesterday' } }).success).toBe(false);
  });

  it('is optional on an app manifest', () => {
    expect(AppManifestSchema.parse({ id: 'sales', name: 'Sales', icon: 'target', description: 'Deals.', entry: '/dashboard/p/deals' }).home).toBeUndefined();
  });
});

describe('the shipped homes', () => {
  it('gives SEO, Finance, GTM and Paid Marketing a home with icons the page can draw', () => {
    const withHome = listApps().filter(a => a.home).map(a => a.id).sort();

    expect(withHome).toEqual(['finance', 'gtm', 'marketing', 'seo']);

    for (const app of listApps().filter(a => a.home)) {
      for (const tile of app.home!.launch) {
        expect(ICONS_BY_NAME[tile.icon], `${app.id}: ${tile.title} icon ${tile.icon}`).toBeDefined();
      }
    }
  });

  it('starts SEO on a reviewed plan and links to actual work stages, with onboarding for an empty app', () => {
    const home = loadApp('seo').home!;

    expect(home.launch.map(t => t.title)).toEqual(['Plan the next pages', 'Audit a site', 'Onboard a client', 'Review drafts', 'Resolve revisions', 'Check publishing']);
    expect(firstTile(home).firstTitle).toBe('Onboard your first client');
    expect(home.launch.find(t => t.title === 'Check publishing')!.href).toBe('/dashboard/p/seo-pages?status=publishing');
    expect(home.projects!.measures.map(m => m.key)).toEqual(['goal', 'live', 'findings', 'ranking', 'prompts']);
    expect(recordTypesOf(home)).toEqual(['seo_page', 'seo_strategy', 'seo_audit', 'seo_keyword', 'seo_prompt']);
  });
});

describe('records measures', () => {
  const pages = [
    row(1, { projectId: 7, status: 'published', publishedAt: '2026-10-03T10:00:00Z' }),
    row(2, { projectId: 7, status: 'published', publishedAt: '2026-10-21T10:00:00Z' }),
    row(3, { projectId: 7, status: 'published', publishedAt: '2026-09-28T10:00:00Z' }),
    row(4, { projectId: 7, status: 'drafting' }),
  ];

  it('counts this month\'s live pages against the project\'s cadence, dated by the newest', () => {
    const m = measure({ source: 'records', objectType: 'seo_page', where: [{ field: 'meta.status', op: 'eq', value: 'published' }, { field: 'meta.publishedAt', op: 'since', value: 'month' }], date: 'meta.publishedAt', target: 'meta.seoCadence.pagesPerMonth', href: '/dashboard/p/seo-pages?project={projectId}&status=published' });

    expect(readRecordsMeasure(m, pages, { project, now: NOW })).toEqual({ key: 'm', label: 'Measure', value: '2', note: 'of 8', href: '/dashboard/p/seo-pages?project=7&status=published', at: '2026-10-21T10:00:00.000Z' });
  });

  it('says "of N" from its own denominator, and a zero is still a reading', () => {
    const keywords = [row(1, { status: 'idea' }), row(2, { status: 'in_batch' }), row(3, { status: 'dropped' })];
    const m = measure({ source: 'records', objectType: 'seo_keyword', where: { field: 'meta.status', op: 'eq', value: 'ranking' }, of: { field: 'meta.status', op: 'neq', value: 'dropped' } });

    expect(readRecordsMeasure(m, keywords, { now: NOW })).toMatchObject({ value: '0', note: 'of 2' });
  });

  it('shows the newest record\'s field with its breakdown, linked to that record', () => {
    const audits = [
      row(11, { openCount: 9, checkedAt: '2026-10-02T00:00:00Z', counts: { bySeverity: { high: 4, medium: 5, low: 0 } } }),
      row(12, { openCount: 6, checkedAt: '2026-10-28T00:00:00Z', counts: { bySeverity: { high: 1, medium: 3, low: 2 } } }),
    ];
    const m = measure({ source: 'records', objectType: 'seo_audit', stat: 'latest', field: 'meta.openCount', date: 'meta.checkedAt', breakdown: [{ label: 'High', field: 'meta.counts.bySeverity.high' }, { label: 'Medium', field: 'meta.counts.bySeverity.medium' }], href: '/dashboard/objects/{id}' });

    expect(readRecordsMeasure(m, audits, { now: NOW })).toEqual({ key: 'm', label: 'Measure', value: '6', note: 'High 1 · Medium 3', href: '/dashboard/objects/12', at: '2026-10-28T00:00:00.000Z' });
  });

  it('leaves out a latest figure with no record, and a sum with no number', () => {
    expect(readRecordsMeasure(measure({ source: 'records', objectType: 'seo_strategy', stat: 'latest', field: 'meta.progressLine' }), [], { now: NOW })).toBeNull();
    expect(readRecordsMeasure(measure({ source: 'records', objectType: 'growth_brief', stat: 'sum', field: 'meta.actualCents', format: 'cents' }), [row(1, {})], { now: NOW })).toBeNull();
    expect(readRecordsMeasure(measure({ source: 'records', objectType: 'growth_brief', stat: 'sum', field: 'meta.actualCents', format: 'cents' }), [row(1, { actualCents: 125000 }), row(2, { actualCents: '2500' })], { now: NOW })!.value).toBe('$1,275');
  });

  it('draws no link it cannot fill', () => {
    expect(measureHref('/dashboard/p/seo-pages?project={projectId}', {})).toBeNull();
    expect(measureHref('/dashboard/goals/{meta.goalId}', { row: row(1, {}) })).toBeNull();
    expect(measureHref('/dashboard/inbox', {})).toBe('/dashboard/inbox');
  });
});

describe('project, state, approvals and mission measures', () => {
  it('reads a field of the project\'s own record', () => {
    const room = row(5, { anchor: { amount: 48000 }, stage: 'Proposal', statusAt: '2026-10-20T00:00:00Z' });

    expect(readProjectMeasure(measure({ source: 'project', field: 'meta.anchor.amount', format: 'money', href: '/dashboard/projects/{projectId}' }), room)).toMatchObject({ value: '$48,000', href: '/dashboard/projects/5' });
    expect(readProjectMeasure(measure({ source: 'project', field: 'meta.stage', date: 'meta.statusAt' }), room)).toMatchObject({ value: 'Proposal', at: '2026-10-20T00:00:00.000Z' });
    expect(readProjectMeasure(measure({ source: 'project', field: 'meta.missing' }), room)).toBeNull();
  });

  it('dates a state figure by its oldest sync, and says nothing for a system that is not connected or never synced', () => {
    const m = measure({ source: 'state', query: { sets: ['crm.deal'] }, sum: 'amount', format: 'money' });
    const read = { total: 12, sum: 310500, missing: [], syncedAt: [new Date('2026-10-30T06:00:00Z'), new Date('2026-10-29T06:00:00Z')] };

    expect(readStateMeasure(m, read, '/dashboard/chat?ask=x')).toEqual({ key: 'm', label: 'Measure', value: '$310,500', note: '12 items', href: '/dashboard/chat?ask=x', at: '2026-10-29T06:00:00.000Z' });
    expect(readStateMeasure(m, { total: 0, sum: null, missing: ['crm.deal'], syncedAt: [] }, null)).toBeNull();
    expect(readStateMeasure(measure({ source: 'state', view: 'stale-deals' }), { total: 0, missing: [], syncedAt: [null] }, null)).toBeNull();
    expect(readStateMeasure(measure({ source: 'state', view: 'stale-deals' }), { total: 3, missing: [], syncedAt: [new Date('2026-10-30T06:00:00Z')] }, null)!.value).toBe('3');
  });

  it('counts the proposals waiting for its actions, a prefix or exact, and on a project only that project\'s', () => {
    const waiting = [
      { actionId: 'finance.draft_invoice', createdAt: new Date('2026-10-28T00:00:00Z'), input: {} },
      { actionId: 'finance.post_journal_entry', createdAt: new Date('2026-10-25T00:00:00Z'), input: {} },
      { actionId: 'meeting.draft_followup', createdAt: new Date('2026-10-29T00:00:00Z'), input: { roomId: 5 } },
      { actionId: 'meeting.draft_followup', createdAt: new Date('2026-10-27T00:00:00Z'), input: { roomId: 6 } },
    ];

    expect(actionMatches('finance.draft_invoice', ['finance.*'])).toBe(true);
    expect(actionMatches('financex.draft', ['finance.*'])).toBe(false);
    expect(readApprovalsMeasure(measure({ source: 'approvals', actions: ['finance.*'] }), waiting)).toMatchObject({ value: '2', at: '2026-10-25T00:00:00.000Z', atLabel: 'oldest from', href: '/dashboard/inbox' });
    expect(readApprovalsMeasure(measure({ source: 'approvals', actions: ['meeting.draft_followup'], projectKey: 'roomId' }), waiting, 5)).toMatchObject({ value: '1', at: '2026-10-29T00:00:00.000Z' });
    expect(readApprovalsMeasure(measure({ source: 'approvals', actions: ['google_ads.*'] }), waiting)).toMatchObject({ value: '0', at: null });
  });

  it('says where a mission\'s newest run stands, and when', () => {
    const m = measure({ source: 'mission', mission: 'close-the-month' });

    expect(readMissionMeasure(m, { id: 31, status: 'running', createdAt: new Date('2026-10-02T16:00:00Z'), updatedAt: new Date('2026-10-03T09:00:00Z') })).toEqual({ key: 'm', label: 'Measure', value: 'Running', note: null, href: '/dashboard/missions/runs/31', at: '2026-10-03T09:00:00.000Z', atLabel: 'on' });
    expect(readMissionMeasure(m, null)).toBeNull();
  });

  it('formats money and counts the way a person reads them', () => {
    expect(formatFigure(1234)).toBe('1,234');
    expect(formatFigure(12.5, 'money')).toBe('$12.50');
    expect(formatFigure(125000, 'cents')).toBe('$1,250');
  });
});

describe('projectsUsingApp', () => {
  const rooms = [
    { ...row(1, {}), updatedAt: new Date('2026-10-10T00:00:00Z') },
    { ...row(2, { seoProfile: { clientType: 'b2b_saas' } }), updatedAt: new Date('2026-10-20T00:00:00Z') },
    { ...row(3, {}), updatedAt: new Date('2026-10-25T00:00:00Z') },
    { ...row(4, {}), updatedAt: new Date('2026-10-29T00:00:00Z') },
  ];

  it('keeps the projects the app\'s records name and those its filter keeps, newest first', () => {
    expect(projectsUsingApp(rooms, new Set([1, 3]), { field: 'meta.seoProfile', op: 'exists' }, { limit: 10, now: NOW }).map(p => p.id)).toEqual([3, 2, 1]);
    expect(projectsUsingApp(rooms, new Set([1, 3]), undefined, { limit: 1, now: NOW }).map(p => p.id)).toEqual([3]);
  });

  it('keeps a deal whose stage was typed as closed off the list, and one with no stage on it', () => {
    const deals = [
      { ...row(5, { anchor: { type: 'deal' }, stage: 'Proposal Sent' }), updatedAt: new Date('2026-10-28T00:00:00Z') },
      { ...row(6, { anchor: { type: 'deal' }, stage: 'Closed Lost (pending HubSpot update)' }), updatedAt: new Date('2026-10-29T00:00:00Z') },
      { ...row(7, { anchor: { type: 'deal' } }), updatedAt: new Date('2026-10-27T00:00:00Z') },
    ];
    const include = [{ field: 'meta.anchor', op: 'exists' as const }, { field: 'meta.stage', op: 'lacks' as const, value: 'closed' }];

    expect(projectsUsingApp(deals, new Set(), include, { limit: 10, now: NOW }).map(p => p.id)).toEqual([5, 7]);
    expect(loadApp('gtm').home!.projects!.include).toEqual(include);
  });
});

describe('the home\'s words and links', () => {
  it('greets by the hour and the first name', () => {
    expect([greetingPart(8), greetingPart(13), greetingPart(19)]).toEqual(['morning', 'afternoon', 'evening']);
    expect(firstNameOf({ name: 'Avery Quinn' })).toBe('Avery');
    expect(firstNameOf({ name: '', email: 'jo.park@example.com' })).toBe('Jo');
    expect(firstNameOf({})).toBeNull();
  });

  it('sends an ask, leaves a prompt to finish, opens a page or a workflow\'s run form', () => {
    expect(tileHref({ ask: 'Audit a site.' })).toBe('/dashboard/chat?ask=Audit%20a%20site.');
    expect(tileHref({ prompt: 'Onboard: ' })).toBe('/dashboard/chat?new=1&prompt=Onboard%3A%20');
    expect(tileHref({ href: '/dashboard/p/seo-pages?status=approved' })).toBe('/dashboard/p/seo-pages?status=approved');
    expect(tileHref({ workflow: 'seo-plan' })).toBe('/dashboard/workflows/seo-plan/run');
    expect(askHref('  what is ranking?  ')).toBe('/dashboard/chat?ask=what%20is%20ranking%3F');
  });
});
