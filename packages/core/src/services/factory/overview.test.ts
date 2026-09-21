import type { OverviewAsk, OverviewInput, OverviewPanelView, OverviewProposal, OverviewRecord } from './overview';
import type { HumanLoad, HumanLoadCounts } from '@/services/team-report/humanLoad';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { PageManifestSchema } from '@/libs/workspace/pageFields';
import { assembleOverview, decisionSubject, describeAge, judgmentLine } from './overview';

/**
 * The factory briefing, panel by panel, on fixtures shaped like the records
 * the live `squatch-factory` workspace actually holds: two products, requests
 * with a `meta.state` beside their status, engineering tasks with an estimate
 * and an actual on every row, releases with a `releasedAt`, and open decisions
 * that carry a `sourceRef` but no `objectRefs`.
 *
 * Nothing here touches a database, so every assertion is about MEANING: what
 * the page says, what it refuses to say, and what it says when it has nothing
 * to report.
 */

const NOW = new Date('2026-09-21T18:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function record(partial: Partial<OverviewRecord> & { id: number; typeSlug: string }): OverviewRecord {
  return {
    title: `record ${partial.id}`,
    status: null,
    meta: {},
    createdAt: ago(30 * DAY),
    updatedAt: ago(30 * DAY),
    ...partial,
  };
}

function ask(partial: Partial<OverviewAsk> & { id: number }): OverviewAsk {
  return {
    kind: 'ruling',
    title: `ask ${partial.id}`,
    risk: 'medium',
    decisionCost: null,
    status: 'open',
    createdAt: ago(2 * HOUR),
    decidedAt: null,
    objectRefs: [],
    sourceRef: null,
    groupKey: null,
    options: [],
    ...partial,
  };
}

function proposal(partial: Partial<OverviewProposal> & { id: number }): OverviewProposal {
  return {
    title: `Action · notify.requester`,
    actionId: 'notify.requester',
    createdAt: ago(HOUR),
    ...partial,
  };
}

const PANELS = {
  judgment: { kind: 'judgment', title: 'Judgment' },
  status: {
    kind: 'status',
    title: 'Products',
    objectType: 'product',
    headline: 'title',
    healthField: 'meta.health',
    rowLink: '/dashboard/objects/{id}',
    facts: [
      { kind: 'field', label: 'stage', from: 'meta.stage' },
      { kind: 'field', label: 'health', from: 'meta.health' },
      { kind: 'related', label: 'open requests', objectType: 'request', relatedField: 'meta.product', subjectFields: ['meta.slug', 'title'], excludeStatus: ['shipped', 'rejected'] },
      { kind: 'related', label: 'changes building', objectType: 'engineering_task', relatedField: 'meta.productSlug', subjectFields: ['meta.slug', 'title'], status: ['awaiting_review', 'running'] },
    ],
  },
  digest: {
    kind: 'digest',
    title: 'Since last visit',
    fallbackHours: 24,
    arrivals: [{ objectType: 'request', label: 'requests arrived', dateFields: ['meta.askedAt', 'createdAt'] }],
    transitions: [
      { objectType: 'request', to: ['shipped'], label: 'shipped', dateFields: ['meta.releasedAt', 'updatedAt'], detail: 2 },
      { objectType: 'engineering_task', to: ['accepted'], label: 'changes accepted', dateFields: ['meta.acceptedAt', 'updatedAt'], detail: 2 },
    ],
    rollups: [{ objectType: 'release', label: 'releases', dateFields: ['meta.releasedAt', 'createdAt'], moneyField: 'meta.actualCents' }],
    decisions: { label: 'decisions arrived', risk: [] },
  },
  active: {
    kind: 'active',
    title: 'In progress',
    objectType: 'request',
    statusIn: ['active', 'building'],
    limit: 3,
    rowLink: '/dashboard/p/feature/{id}',
    tasks: {
      objectType: 'engineering_task',
      joinField: 'meta.requestId',
      completeStatus: ['accepted'],
      workingStatus: ['claimed', 'running'],
      waitingStatus: ['awaiting_review'],
    },
  },
  next: {
    kind: 'next',
    title: 'Next',
    objectType: 'request',
    statusIn: ['new', 'candidate'],
    orderBy: 'meta.priority',
    limit: 3,
    noteFields: ['whyNote', 'priorityReason'],
  },
  needsYou: {
    kind: 'needsYou',
    title: 'Needs you',
    href: '/dashboard/inbox',
    limit: 3,
    perRecordSources: ['action_run', 'mission-check'],
  },
  economics: {
    kind: 'economics',
    title: 'Economics',
    windowDays: 30,
    objectType: 'engineering_task',
    dateFields: ['meta.costUpdatedAt', 'createdAt'],
    costField: 'meta.actualCents',
    acceptedStatus: ['accepted'],
    reworkStatus: ['rejected', 'abandoned'],
  },
  autonomy: { kind: 'autonomy', title: 'Autonomy', windowDays: 7 },
} as const;

/**
 * Panels parsed by the real manifest schema, so a fixture cannot drift into a
 * shape the shipped YAML could not express.
 * @param kinds - Panel kinds, in the order the page declares them.
 */
function panelsFor(kinds: readonly string[]) {
  const manifest = PageManifestSchema.parse({
    slug: 'factory',
    title: 'Factory',
    archetype: 'overview',
    panels: kinds.map(k => PANELS[k as keyof typeof PANELS]),
  });
  return manifest.panels!;
}

function input(kinds: readonly string[], over: Partial<OverviewInput> = {}): OverviewInput {
  return {
    panels: panelsFor(kinds),
    records: [],
    asks: [],
    pendingProposals: [],
    humanLoad: null,
    lastSeenAt: null,
    now: NOW,
    ...over,
  };
}

function one<K extends OverviewPanelView['kind']>(kind: K, over: Partial<OverviewInput> = {}): Extract<OverviewPanelView, { kind: K }> {
  const [panel] = assembleOverview(input([kind], over)).panels;
  return panel as Extract<OverviewPanelView, { kind: K }>;
}

/** The whole page, in the shipped order, for the judgment-line assertions. */
const PAGE = ['judgment', 'needsYou', 'active', 'next', 'digest', 'status', 'economics', 'autonomy'] as const;

function judgment(over: Partial<OverviewInput> = {}): string {
  const [panel] = assembleOverview(input(PAGE, over)).panels;
  return (panel as Extract<OverviewPanelView, { kind: 'judgment' }>).line;
}

/**
 * A human-load reading, built here rather than imported, because
 * `team-report/humanLoad` opens a database connection at import time and
 * everything in this file is meant to run without one.
 * @param over
 */
function load(over: Partial<HumanLoadCounts> = {}): HumanLoad {
  const c: HumanLoadCounts = {
    workItems: 0,
    proposals: 0,
    runs: 0,
    completedRuns: 0,
    interventions: 0,
    approvedClean: 0,
    approvedEdited: 0,
    rejected: 0,
    decisionLatencyMs: 0,
    needingDecision: 0,
    executed: 0,
    autoExecuted: 0,
    escalations: 0,
    turnaroundMedianMs: null,
    open: { count: 0, oldestAt: null, blockedMs: 0 },
    ...over,
  };
  const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);
  const decided = c.approvedClean + c.approvedEdited + c.rejected;
  return {
    ...c,
    interventionRate: ratio(c.needingDecision, c.workItems),
    autonomousCompletionRate: ratio(c.autoExecuted, c.executed),
    escalationRate: ratio(c.escalations, c.workItems),
    qualityRate: ratio(c.approvedClean, decided),
    unattendedRate: ratio(Math.max(0, c.workItems - c.needingDecision), c.workItems),
  };
}

/**
 * A request with a recorded reason, so it is allowed into the ranked list.
 * @param id
 * @param priority
 * @param title
 */
function reasoned(id: number, priority: number, title: string): OverviewRecord {
  return record({
    id,
    typeSlug: 'request',
    title,
    status: 'new',
    meta: { priority, why: ['blocks_goal'] },
  });
}

/**
 * One outcome with a worker on it right now.
 * @param id
 */
function building(id: number): OverviewRecord[] {
  return [
    record({ id, typeSlug: 'request', title: `outcome ${id}`, status: 'building' }),
    record({ id: id * 100, typeSlug: 'engineering_task', status: 'running', meta: { requestId: id } }),
  ];
}

// ---------------------------------------------------------------------------
// The judgment line
// ---------------------------------------------------------------------------

describe('the judgment line', () => {
  it('says the factory is stalled when nothing is being built and decisions are waiting', () => {
    const line = judgment({
      records: [record({ id: 1, typeSlug: 'request', status: 'active' })],
      asks: [
        ask({ id: 10, sourceRef: 'mission-check:a', objectRefs: [{ type: 'request', id: '1' }] }),
        ask({ id: 11, sourceRef: 'mission-check:b' }),
      ],
    });

    expect(line).toBe('Stalled: nothing is being built and 2 decisions are waiting on you. 1 of them names work it is holding up.');
  });

  it('never claims things are moving well when most recent spend was reworked', () => {
    const line = judgment({
      records: [
        ...building(7),
        record({ id: 801, typeSlug: 'engineering_task', status: 'accepted', meta: { actualCents: 200, costUpdatedAt: ago(DAY) } }),
        record({ id: 802, typeSlug: 'engineering_task', status: 'rejected', meta: { actualCents: 500, costUpdatedAt: ago(DAY) } }),
        record({ id: 803, typeSlug: 'engineering_task', status: 'abandoned', meta: { actualCents: 300, costUpdatedAt: ago(DAY) } }),
      ],
    });

    // Work IS in flight and nothing needs a person, which is exactly the shape
    // that used to earn a cheerful summary. The rework clause forbids it.
    expect(line).toBe('1 outcome in progress and nothing needs you. 80% of recent spend went on attempts that did not land.');
    expect(line).not.toMatch(/healthy|on track|going well/i);
  });

  it('is narrow rather than confident when the records support nothing', () => {
    expect(judgment()).toBe('Idle. Nothing is being built, nothing is queued and nothing needs you.');
    expect(judgmentLine([])).toBe('Not enough is recorded yet to say how the factory is doing.');
  });

  it('names the ranking defect rather than calling an unrankable queue idle', () => {
    const line = judgment({
      records: [record({ id: 5, typeSlug: 'request', status: 'new', title: 'no reason on this one' })],
    });

    expect(line).toBe('Idle. Nothing is being built and nothing needs you, but the queue cannot be ranked until requests record why they matter.');
  });

  it('reports work in flight beside the decisions waiting, and agrees with both panels', () => {
    const page = assembleOverview(input(PAGE, {
      records: building(7),
      asks: [ask({ id: 10, sourceRef: 'mission-check:a' })],
    })).panels;

    const line = (page[0] as Extract<OverviewPanelView, { kind: 'judgment' }>).line;
    const needs = page.find(p => p.kind === 'needsYou')!;
    const active = page.find(p => p.kind === 'active')!;

    expect(line).toBe('1 outcome in progress, 1 decision waiting on you.');
    expect(needs.count).toBe(1);
    expect(active.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------

describe('needs you', () => {
  it('counts one decision, not eight, when a mission re-files the same question', () => {
    const storm = [67, 68, 69, 70, 71, 77, 79, 95].map((id, i) => ask({
      id,
      sourceRef: `every-asker-hears-back:escalation-check-${i}`,
      risk: i > 2 ? 'high' : 'medium',
      createdAt: ago((10 - i) * HOUR),
    }));
    const panel = one('needsYou', { asks: [...storm, ask({ id: 96, sourceRef: 'mission-check:2026-09-21:admin-panel' })] });

    expect(panel.count).toBe(2);
    expect(panel.rows[0]!.restated).toBe(7);
    expect(panel.accounting).toBe('7 open records restate decisions already in this list. Both are on Review.');
  });

  it('keeps two decisions apart when their source names a record rather than a subject', () => {
    const panel = one('needsYou', {
      asks: [
        ask({ id: 96, sourceRef: 'mission-check:2026-09-21:admin-panel' }),
        ask({ id: 97, sourceRef: 'mission-check:2026-09-21:nightly-e2e' }),
        ask({ id: 61, sourceRef: 'action_run:2396' }),
        ask({ id: 62, sourceRef: 'action_run:2393' }),
      ],
    });

    expect(panel.count).toBe(4);
  });

  it('reconciles the count so one number means human judgment required', () => {
    // Twenty-two open records and thirteen queued approvals used to print as
    // "35 open decisions" next to a 7-day figure of 6. Neither was a count of
    // what a person has to decide.
    const asks = [
      ...[67, 68, 69, 70, 71, 77, 79, 95].map(id => ask({ id, sourceRef: 'every-asker-hears-back:check' })),
      ...[61, 62, 63, 64, 65, 66, 81, 84].map(id => ask({ id, sourceRef: `action_run:${id}` })),
      ...[96, 97].map(id => ask({ id, sourceRef: `mission-check:${id}` })),
      ...[59, 76, 78, 80].map(id => ask({ id, sourceRef: `subject-${id}` })),
    ];
    const proposals = Array.from({ length: 13 }, (_, i) => proposal({ id: 2600 + i }));
    const panel = one('needsYou', { asks, pendingProposals: proposals });

    expect(asks).toHaveLength(22);
    expect(panel.count).toBe(15);
    expect(panel.accounting).toBe('7 open records restate decisions already in this list; 13 routine approvals are waiting on a yes an agent already recommended. Both are on Review.');
    // 15 judgment calls + 7 restatements + 13 routine approvals = the 35 the
    // page used to print as one number.
    expect(panel.count + 7 + proposals.length).toBe(35);
  });

  it('shows at most three decisions, blocking work first, with the filed recommendation', () => {
    const panel = one('needsYou', {
      asks: [
        ask({ id: 1, risk: 'high', sourceRef: 'a', createdAt: ago(9 * HOUR) }),
        ask({ id: 2, risk: 'low', sourceRef: 'b', objectRefs: [{ type: 'request', id: '40' }], options: [{ label: 'Ship the rename first', recommended: true }, { label: 'Admin panel first' }] }),
        ask({ id: 3, risk: 'medium', sourceRef: 'c', createdAt: ago(8 * HOUR) }),
        ask({ id: 4, risk: 'low', sourceRef: 'd' }),
      ],
    });

    expect(panel.rows).toHaveLength(3);
    expect(panel.rows.map(r => r.id)).toEqual([2, 1, 3]);
    expect(panel.rows[0]!.blocksWork).toBe(true);
    expect(panel.rows[0]!.recommendation).toBe('Ship the rename first');
    expect(panel.rows[1]!.recommendation).toBeNull();
    expect(panel.blocking).toBe(1);
    expect(panel.more).toBe(1);
  });

  it('collapses to one line when nothing needs a person', () => {
    expect(one('needsYou').collapsed).toBe('Nothing needs you.');
    expect(one('needsYou').rows).toEqual([]);
  });

  it('still says where the routine approvals went when nothing needs judgment', () => {
    const panel = one('needsYou', { pendingProposals: [proposal({ id: 1 }), proposal({ id: 2 })] });

    expect(panel.collapsed).toBe('Nothing needs your judgment. 2 routine approvals are waiting on a yes on Review.');
  });

  it('groups by the write side\'s own key when it set one', () => {
    expect(decisionSubject(ask({ id: 1, groupKey: 'batch/2026-09-20', sourceRef: 'x:y' }), [])).toBe('group:batch/2026-09-20');
    expect(decisionSubject(ask({ id: 1, sourceRef: 'mission:a' }), [])).toBe('subject:mission');
    expect(decisionSubject(ask({ id: 1, sourceRef: 'mission:a' }), ['mission'])).toBe('ref:mission:a');
    expect(decisionSubject(ask({ id: 1, sourceRef: null }), [])).toBe('ask:1');
  });
});

// ---------------------------------------------------------------------------
// In progress
// ---------------------------------------------------------------------------

describe('in progress', () => {
  it('lists only outcomes a worker is on right now', () => {
    const panel = one('active', {
      records: [
        ...building(7),
        record({ id: 8, typeSlug: 'request', title: 'approved, never contracted', status: 'active' }),
        record({ id: 9, typeSlug: 'request', title: 'every task stopped', status: 'active' }),
        record({ id: 900, typeSlug: 'engineering_task', status: 'awaiting_review', meta: { requestId: 9 } }),
      ],
    });

    expect(panel.rows.map(r => r.title)).toEqual(['outcome 7']);
    expect(panel.rows[0]!.progress).toBe('1 task running, 0 of 1 done');
  });

  it('accounts for what left the panel rather than showing an empty box', () => {
    const panel = one('active', {
      records: [
        record({ id: 8, typeSlug: 'request', status: 'active' }),
        record({ id: 9, typeSlug: 'request', status: 'active' }),
        record({ id: 10, typeSlug: 'request', status: 'building' }),
        record({ id: 900, typeSlug: 'engineering_task', status: 'awaiting_review', meta: { requestId: 10 } }),
      ],
    });

    expect(panel.rows).toEqual([]);
    expect(panel.empty).toBe('Nothing is being built right now. 2 approved outcomes have no task contract yet and 1 change is waiting on a review; both are on Work.');
  });

  it('never calls an outcome with no contracted task in flight', () => {
    const panel = one('active', { records: [record({ id: 8, typeSlug: 'request', status: 'active' })] });

    expect(panel.rows).toEqual([]);
    expect(panel.empty).not.toMatch(/waiting on a task contract/);
  });
});

// ---------------------------------------------------------------------------
// Next
// ---------------------------------------------------------------------------

describe('next', () => {
  it('refuses to rank a request that recorded no reason, and says so once', () => {
    const panel = one('next', {
      records: [
        reasoned(38, 62, 'Vocion fail endpoint cannot carry the kept branch'),
        reasoned(30, 58, 'Send has no admin panel'),
        record({ id: 79, typeSlug: 'request', status: 'new', title: 'ranked highest, no reason', meta: { priority: 70, priorityReason: 'Promise kept: the board must be honest.' } }),
        record({ id: 94, typeSlug: 'request', status: 'new', title: 'no reason either' }),
        record({ id: 89, typeSlug: 'request', status: 'new', title: 'nor this' }),
      ],
    });

    expect(panel.rows.map(r => r.id)).toEqual([38, 30]);
    expect(panel.rows.map(r => r.id)).not.toContain(79);
    expect(panel.unreasoned).toBe('3 queued requests carry no recorded reason, so they cannot be ranked. Recording why is what puts them in this list.');
    // The defect is stated once, not apologised for on every row.
    expect(panel.rows.every(r => !r.why.includes('no reason recorded'))).toBe(true);
  });

  it('caps at three', () => {
    const panel = one('next', {
      records: [90, 80, 70, 60].map((p, i) => reasoned(i + 1, p, `request ${i + 1}`)),
    });

    expect(panel.rows.map(r => r.id)).toEqual([1, 2, 3]);
  });

  it('designs the empty state when every queued request is unreasoned', () => {
    const panel = one('next', {
      records: [record({ id: 1, typeSlug: 'request', status: 'new', meta: { priority: 70 } })],
    });

    expect(panel.rows).toEqual([]);
    expect(panel.empty).toBe('Nothing can be ranked: every queued request is missing its reason, so the factory has no defensible order to work in.');
  });

  it('says the queue is empty when it is actually empty', () => {
    expect(one('next').empty).toBe('Nothing is queued. The factory intends no new work.');
    expect(one('next').unreasoned).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Since last visit
// ---------------------------------------------------------------------------

describe('since last visit', () => {
  it('collapses to one line when nothing changed', () => {
    const panel = one('digest', { lastSeenAt: ago(3 * HOUR) });

    expect(panel.lines).toEqual([]);
    expect(panel.collapsed).toBe('Nothing changed in 3 hours ago.');
  });

  it('expands when there is something to say', () => {
    const panel = one('digest', {
      lastSeenAt: ago(3 * HOUR),
      records: [
        record({ id: 1, typeSlug: 'request', status: 'new', meta: { askedAt: ago(HOUR).toISOString() } }),
        record({ id: 2, typeSlug: 'release', meta: { releasedAt: ago(HOUR).toISOString(), actualCents: 1250 } }),
      ],
    });

    expect(panel.collapsed).toBeNull();
    expect(panel.lines).toEqual(['1 request arrived', '$12.50 across 1 release']);
  });

  it('says plainly that a first visit is a fixed window, not a memory', () => {
    expect(one('digest').heading).toBe('the last 24 hours, since you have not opened this page before');
  });
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

describe('products', () => {
  it('reads as a sentence, and says "not connected" rather than "health unknown"', () => {
    const panel = one('status', {
      records: [
        record({ id: 25, typeSlug: 'product', title: 'Send', meta: { slug: 'send', stage: 'dogfood', health: 'ok' } }),
        record({ id: 26, typeSlug: 'product', title: 'Slate', meta: { slug: 'slate', stage: 'live', health: 'unknown' } }),
        record({ id: 1, typeSlug: 'request', status: 'active', meta: { product: 'send' } }),
        record({ id: 2, typeSlug: 'engineering_task', status: 'running', meta: { productSlug: 'send' } }),
      ],
    });

    expect(panel.rows[0]!.summary).toBe('dogfood · health ok · 1 open request, 1 change building.');
    expect(panel.rows[1]!.summary).toBe('live, but not connected to the factory: no work, and nothing reports its health.');
  });

  it('does not call a product disconnected merely because its health is unknown', () => {
    const panel = one('status', {
      records: [
        record({ id: 26, typeSlug: 'product', title: 'Slate', meta: { slug: 'slate', stage: 'live', health: 'unknown' } }),
        record({ id: 1, typeSlug: 'request', status: 'active', meta: { product: 'slate' } }),
      ],
    });

    expect(panel.rows[0]!.summary).toBe('live · health unknown · 1 open request.');
  });
});

// ---------------------------------------------------------------------------
// Economics
// ---------------------------------------------------------------------------

describe('economics', () => {
  it('prefers a trend to an explanation', () => {
    const panel = one('economics', {
      records: [
        record({ id: 1, typeSlug: 'engineering_task', status: 'accepted', meta: { actualCents: 800, costUpdatedAt: ago(2 * DAY) } }),
        record({ id: 2, typeSlug: 'engineering_task', status: 'accepted', meta: { actualCents: 1200, costUpdatedAt: ago(40 * DAY) } }),
      ],
    });

    expect(panel.figures[0]).toEqual({ label: 'Spend, last 30 days', value: '$8.00', note: '33% down on the 30 days before' });
  });

  it('says there is no earlier window rather than inventing a change', () => {
    const panel = one('economics', {
      records: [record({ id: 1, typeSlug: 'engineering_task', status: 'accepted', meta: { actualCents: 800, costUpdatedAt: ago(2 * DAY) } })],
    });

    expect(panel.figures[0]!.note).toBe('no earlier window to compare yet');
  });

  it('calls a failed attempt rework, not waste', () => {
    const panel = one('economics', {
      records: [
        record({ id: 1, typeSlug: 'engineering_task', status: 'accepted', meta: { actualCents: 600, costUpdatedAt: ago(DAY) } }),
        record({ id: 2, typeSlug: 'engineering_task', status: 'rejected', meta: { actualCents: 400, costUpdatedAt: ago(DAY) } }),
      ],
    });

    expect(panel.figures.map(f => f.label)).toEqual(['Spend, last 30 days', 'Cost per accepted change', 'Rework spend']);
    expect(panel.figures[2]).toEqual({ label: 'Rework spend', value: '$4.00', note: '40% of spend, across 1 attempt that did not land' });
    expect(JSON.stringify(panel)).not.toMatch(/waste/i);
  });

  it('leaves out cost per accepted change rather than drawing it as not measurable', () => {
    const panel = one('economics', {
      records: [record({ id: 1, typeSlug: 'engineering_task', status: 'rejected', meta: { actualCents: 400, costUpdatedAt: ago(DAY) } })],
    });

    expect(panel.figures.map(f => f.label)).toEqual(['Spend, last 30 days', 'Rework spend']);
    expect(JSON.stringify(panel)).not.toMatch(/not measurable/i);
  });
});

// ---------------------------------------------------------------------------
// Autonomy
// ---------------------------------------------------------------------------

describe('autonomy', () => {
  it('is four numbers and one thing to do about them', () => {
    const panel = one('autonomy', {
      humanLoad: load({ workItems: 20, needingDecision: 6, executed: 10, autoExecuted: 9, interventions: 6, approvedClean: 4 }),
      pendingProposals: Array.from({ length: 13 }, (_, i) => proposal({ id: i })),
    });

    expect(panel.figures.map(f => f.label)).toEqual([
      'Finished without you',
      'Ran under a trust rule',
      'Decisions you answered, last 7 days',
      'Approved unchanged',
    ]);
    expect(panel.sentence).toBe('13 queued approvals are all notify.requester. A trust rule for it would take them off your desk.');
  });

  it('names the 7-day figure as throughput, so it cannot be read against the open queue', () => {
    const panel = one('autonomy', { humanLoad: load({ workItems: 20, needingDecision: 6, interventions: 6 }) });

    expect(panel.figures.map(f => f.label)).not.toContain('Meaningful decisions required');
    expect(panel.figures.find(f => f.label.startsWith('Decisions you answered'))!.note).toBe('throughput, not the queue: what is open is under Needs you');
  });

  it('draws no card at all where a rate cannot be computed', () => {
    const panel = one('autonomy', { humanLoad: load() });

    expect(panel.figures.map(f => f.label)).toEqual(['Decisions you answered, last 7 days', 'Approved unchanged']);
    expect(JSON.stringify(panel)).not.toMatch(/not measurable/i);
    expect(panel.sentence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The shipped manifest
// ---------------------------------------------------------------------------

describe('the shipped factory page', () => {
  const manifest = PageManifestSchema.parse(parseYaml(readFileSync(
    path.join(process.cwd(), 'templates/plugins/software-factory/pages/factory.yaml'),
    'utf8',
  )));

  it('briefs in the order a person needs it', () => {
    expect(manifest.panels!.map(p => p.kind)).toEqual([
      'judgment',
      'needsYou',
      'active',
      'next',
      'digest',
      'status',
      'economics',
      'autonomy',
    ]);
  });

  it('keeps every word of methodology behind the affordance', () => {
    for (const panel of manifest.panels!) {
      expect(panel.note).toBeUndefined();
    }

    expect(manifest.panels!.filter(p => p.method !== undefined).length).toBeGreaterThan(5);
  });

  it('caps the two lists a person reads first at three', () => {
    const needsYou = manifest.panels!.find(p => p.kind === 'needsYou')!;
    const next = manifest.panels!.find(p => p.kind === 'next')!;

    expect(needsYou.limit).toBe(3);
    expect(next.limit).toBe(3);
  });
});

describe('describeAge', () => {
  it('reads as a person would say it', () => {
    expect(describeAge(90_000)).toBe('2 minutes');
    expect(describeAge(3 * HOUR)).toBe('3 hours');
    expect(describeAge(HOUR)).toBe('1 hour');
    expect(describeAge(2 * DAY)).toBe('2 days');
  });
});
