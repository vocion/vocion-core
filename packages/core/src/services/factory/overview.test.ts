import type { OverviewAsk, OverviewInput, OverviewPanelView, OverviewRecord } from './overview';
import type { HumanLoad, HumanLoadCounts } from '@/services/team-report/humanLoad';
import { describe, expect, it } from 'vitest';
import { PageManifestSchema } from '@/libs/workspace/pageFields';
import { assembleOverview, describeAge } from './overview';

/**
 * The factory control plane, panel by panel, on fixtures shaped like the
 * records the live `squatch-factory` workspace actually holds: two products,
 * requests with a `meta.state` beside their status, engineering tasks with an
 * estimate and an actual on every row, releases with a `releasedAt`, and asks
 * that carry a `decisionCost` but no `objectRefs`.
 *
 * Nothing here touches a database, so every assertion is about MEANING: what
 * the page says, including what it says when it cannot say a number.
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
    ...partial,
  };
}

const PANELS = {
  status: {
    kind: 'status',
    title: 'Status',
    objectType: 'product',
    headline: 'title',
    rowLink: '/dashboard/objects/{id}',
    facts: [
      { kind: 'field', label: 'stage', from: 'meta.stage' },
      { kind: 'field', label: 'health', from: 'meta.health' },
      { kind: 'related', label: 'open', objectType: 'request', relatedField: 'meta.product', subjectFields: ['meta.slug', 'title'], excludeStatus: ['shipped', 'rejected'] },
      { kind: 'related', label: 'building', objectType: 'engineering_task', relatedField: 'meta.productSlug', subjectFields: ['meta.slug', 'title'], status: ['awaiting_review', 'running'] },
    ],
  },
  digest: {
    kind: 'digest',
    title: 'Since you last looked',
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
    title: 'Working on now',
    objectType: 'request',
    statusIn: ['active', 'building'],
    limit: 7,
    rowLink: '/dashboard/p/feature/{id}',
    tasks: { objectType: 'engineering_task', joinField: 'meta.requestId', completeStatus: ['accepted'], waitingStatus: ['awaiting_review'] },
  },
  next: {
    kind: 'next',
    title: 'Next',
    objectType: 'request',
    statusIn: ['new', 'candidate'],
    orderBy: 'meta.priority',
    limit: 7,
    noteFields: ['whyNote', 'priorityReason'],
  },
  needsYou: { kind: 'needsYou', title: 'Needs you', href: '/dashboard/inbox' },
  economics: {
    kind: 'economics',
    title: 'Economics',
    windowDays: 30,
    objectType: 'engineering_task',
    dateFields: ['meta.costUpdatedAt', 'createdAt'],
    costField: 'meta.actualCents',
    acceptedStatus: ['accepted'],
    wasteStatus: ['rejected', 'abandoned'],
  },
  autonomy: { kind: 'autonomy', title: 'Autonomy', windowDays: 7 },
} as const;

/**
 * The panels the shipped `factory.yaml` declares, parsed by the real schema.
 * @param kind
 */
function panelsFor(kind: string) {
  const manifest = PageManifestSchema.parse({
    slug: 'factory',
    title: 'Factory',
    archetype: 'overview',
    panels: [PANELS[kind as keyof typeof PANELS]],
  });
  return manifest.panels!;
}

function input(kind: string, over: Partial<OverviewInput> = {}): OverviewInput {
  return {
    panels: panelsFor(kind),
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
  const [panel] = assembleOverview(input(kind, over)).panels;
  return panel as Extract<OverviewPanelView, { kind: K }>;
}

/**
 * A human-load reading, built here rather than imported, because
 * `team-report/humanLoad` opens a database connection at import time and
 * everything in this file is meant to run without one. The two rates the
 * autonomy panel reads are spelled out so the fixture states its own
 * arithmetic.
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

// ---------------------------------------------------------------------------

describe('status', () => {
  const products = [
    record({ id: 25, typeSlug: 'product', title: 'Send', status: 'active', meta: { stage: 'dogfood', health: 'ok' } }),
    record({ id: 26, typeSlug: 'product', title: 'Slate', status: 'active', meta: { stage: 'live', health: 'unknown' } }),
  ];
  const related = [
    record({ id: 1, typeSlug: 'request', status: 'active', meta: { product: 'send' } }),
    record({ id: 2, typeSlug: 'request', status: 'new', meta: { product: 'send' } }),
    record({ id: 3, typeSlug: 'request', status: 'shipped', meta: { product: 'send' } }),
    record({ id: 4, typeSlug: 'engineering_task', status: 'awaiting_review', meta: { productSlug: 'send' } }),
    record({ id: 5, typeSlug: 'engineering_task', status: 'accepted', meta: { productSlug: 'send' } }),
  ];

  it('is one line per product: headline, stage, health, what is owed and what is building', () => {
    const panel = one('status', { records: [...products, ...related] });

    expect(panel.rows.map(r => r.headline)).toEqual(['Send', 'Slate']);
    expect(panel.rows[0]!.facts).toEqual([
      { label: 'stage', value: 'dogfood' },
      { label: 'health', value: 'ok' },
      { label: 'open', value: '2' },
      { label: 'building', value: '1' },
    ]);
    expect(panel.rows[0]!.href).toBe('/dashboard/objects/25');
  });

  it('joins a product to its rows case-insensitively, because "Send" is written "send" on them', () => {
    const panel = one('status', { records: [...products, ...related] });

    // Slate has nothing pointing at it; the count is 0, not a blank.
    expect(panel.rows[1]!.facts.map(f => f.value)).toEqual(['live', 'unknown', '0', '0']);
  });

  it('says a fact is not recorded rather than drawing an empty cell', () => {
    const panel = one('status', { records: [record({ id: 9, typeSlug: 'product', title: 'Stamp', meta: {} })] });

    expect(panel.rows[0]!.facts[0]).toEqual({ label: 'stage', value: 'not recorded' });
  });

  it('on an empty workspace says there is nothing to report the state of', () => {
    const panel = one('status');

    expect(panel.rows).toEqual([]);
    expect(panel.empty).toBe('No product records exist yet, so there is nothing to report the state of.');
  });
});

describe('since you last looked', () => {
  const changed = [
    record({ id: 1, typeSlug: 'request', status: 'new', createdAt: ago(3 * HOUR) }),
    record({ id: 2, typeSlug: 'request', status: 'new', createdAt: ago(5 * HOUR) }),
    record({ id: 3, typeSlug: 'request', status: 'new', createdAt: ago(20 * DAY) }),
    record({ id: 4, typeSlug: 'request', title: 'Email sharing', status: 'shipped', meta: { releasedAt: ago(4 * HOUR).toISOString() } }),
    record({ id: 5, typeSlug: 'engineering_task', title: 'Fix invite naming', status: 'accepted', meta: { acceptedAt: ago(2 * HOUR).toISOString() } }),
    record({ id: 6, typeSlug: 'release', status: 'active', meta: { releasedAt: ago(1 * HOUR).toISOString(), actualCents: 340 } }),
    record({ id: 7, typeSlug: 'release', status: 'active', meta: { releasedAt: ago(6 * HOUR).toISOString(), actualCents: 515 } }),
  ];

  it('names what a person would call a change, and rolls deploys into one money line', () => {
    const panel = one('digest', { records: changed, lastSeenAt: ago(12 * HOUR) });

    expect(panel.lines).toEqual([
      '2 requests arrived',
      'shipped: Email sharing',
      'changes accepted: Fix invite naming',
      '$8.55 across 2 releases',
    ]);
    // A release is a count and a sum. It is never named individually here.
    expect(panel.lines.join(' ')).not.toContain('record 6');
  });

  it('counts an arrival by when a person asked, not by when the row was written', () => {
    // The squatch-factory backlog was backfilled in one afternoon, so
    // `createdAt` reports a year of requests as arriving today. The record's
    // own `askedAt` is the fact; `createdAt` is only the fallback.
    const backfilled = [
      record({ id: 1, typeSlug: 'request', createdAt: ago(1 * HOUR), meta: { askedAt: ago(40 * DAY).toISOString() } }),
      record({ id: 2, typeSlug: 'request', createdAt: ago(1 * HOUR), meta: { askedAt: ago(3 * HOUR).toISOString() } }),
      record({ id: 3, typeSlug: 'request', createdAt: ago(2 * HOUR), meta: {} }),
    ];
    const panel = one('digest', { records: backfilled, lastSeenAt: ago(12 * HOUR) });

    expect(panel.lines).toEqual(['2 requests arrived']);
  });

  it('measures from the viewer\'s own last visit and says how long ago that was', () => {
    const panel = one('digest', { records: changed, lastSeenAt: ago(12 * HOUR) });

    expect(panel.sinceKnown).toBe(true);
    expect(panel.heading).toBe('Since you last looked, 12 hours ago');
    expect(panel.since).toEqual(ago(12 * HOUR));
  });

  it('on a first visit falls back to 24 hours AND says so, rather than pretending to remember', () => {
    const panel = one('digest', { records: changed, lastSeenAt: null });

    expect(panel.sinceKnown).toBe(false);
    expect(panel.heading).toBe('The last 24 hours - you have not opened this page before, so this is a fixed window, not your own');
    expect(panel.since).toEqual(ago(24 * HOUR));
  });

  it('flags a line whose timing was read from the last update rather than a recorded stamp', () => {
    const panel = one('digest', {
      lastSeenAt: ago(12 * HOUR),
      records: [record({ id: 8, typeSlug: 'request', title: 'Naming', status: 'shipped', updatedAt: ago(3 * HOUR), meta: {} })],
    });

    expect(panel.lines).toEqual(['shipped: Naming (timing read from last update, not a recorded stamp)']);
  });

  it('counts decisions that arrived in the window', () => {
    const panel = one('digest', { lastSeenAt: ago(12 * HOUR), asks: [ask({ id: 1 }), ask({ id: 2, createdAt: ago(3 * DAY) })] });

    expect(panel.lines).toEqual(['1 decision arrived']);
  });

  it('on an empty workspace says nothing changed, and points the volume elsewhere', () => {
    const panel = one('digest');

    expect(panel.lines).toEqual([]);
    expect(panel.empty).toBe('Nothing a person would call a change. Deploys and worker runs are on Activity.');
  });
});

describe('working on now', () => {
  const outcomes = [
    record({ id: 40, typeSlug: 'request', title: 'Nightly e2e runner', status: 'building', updatedAt: ago(1 * HOUR) }),
    record({ id: 41, typeSlug: 'request', title: 'Observability', status: 'active', updatedAt: ago(5 * HOUR) }),
    record({ id: 42, typeSlug: 'request', title: 'Rename to Stamp', status: 'active', updatedAt: ago(9 * HOUR) }),
    record({ id: 43, typeSlug: 'request', title: 'Already shipped', status: 'shipped' }),
  ];
  const tasks = [
    record({ id: 90, typeSlug: 'engineering_task', title: 'Add the Playwright script', status: 'accepted', meta: { requestId: 40 } }),
    record({ id: 91, typeSlug: 'engineering_task', title: 'Add the cron workflow', status: 'accepted', meta: { requestId: 40 } }),
    record({ id: 92, typeSlug: 'engineering_task', title: 'Wire the runner into CI', status: 'awaiting_review', meta: { requestId: 40 } }),
    record({ id: 93, typeSlug: 'engineering_task', title: 'Record worker cost', status: 'running', meta: { requestId: 41 } }),
  ];

  it('counts progress in tasks, not worker runs, and names what the outcome waits on', () => {
    const panel = one('active', { records: [...outcomes, ...tasks] });

    expect(panel.rows.map(r => [r.title, r.progress, r.waitingOn])).toEqual([
      ['Nightly e2e runner', '2/3 tasks complete', 'a person: "Wire the runner into CI" is awaiting_review'],
      ['Observability', '0/1 tasks complete', 'the factory: work is in progress'],
      ['Rename to Stamp', 'no task has been contracted yet', 'a task contract'],
    ]);
    expect(panel.rows[0]!.href).toBe('/dashboard/p/feature/40');
  });

  it('caps the list and says how much it is not showing', () => {
    const many = Array.from({ length: 10 }, (_, i) => record({ id: 100 + i, typeSlug: 'request', status: 'active', updatedAt: ago(i * HOUR) }));
    const panel = one('active', { records: many });

    expect(panel.rows).toHaveLength(7);
    expect(panel.more).toBe(3);
  });

  it('on an empty workspace says nothing is in flight', () => {
    expect(one('active').empty).toBe('Nothing is in flight. Everything asked for has been answered or shipped.');
  });
});

describe('next', () => {
  const queued = [
    record({ id: 50, typeSlug: 'request', title: 'Rank the backlog', status: 'new', meta: { priority: 70, why: ['user_request', 'blocks_goal'], whyNote: 'three user asks' } }),
    record({ id: 51, typeSlug: 'request', title: 'Stop e2e submissions polluting the backlog', status: 'new', meta: { priority: 65, priorityReason: 'Intake gap: e2e-suite submissions pollute the real backlog.' } }),
    record({ id: 52, typeSlug: 'request', title: 'Unranked but queued', status: 'candidate', meta: {} }),
  ];

  it('orders by the rank and never renders it', () => {
    const panel = one('next', { records: queued });

    expect(panel.rows.map(r => r.id)).toEqual([50, 51, 52]);
    expect(JSON.stringify(panel.rows)).not.toContain('70');
    expect(JSON.stringify(panel.rows)).not.toContain('priority');
  });

  it('renders the recorded reason codes as human phrases', () => {
    const panel = one('next', { records: queued });

    expect(panel.rows[0]!.why).toBe('a person asked for it · it blocks a goal - three user asks');
    expect(panel.rows[0]!.reasonRecorded).toBe(true);
  });

  it('shows prose as a note, never as a reason, when no code was recorded', () => {
    const panel = one('next', { records: queued });

    expect(panel.rows[1]!.reasonRecorded).toBe(false);
    expect(panel.rows[1]!.why).toBe('no reason recorded; the note says: Intake gap: e2e-suite submissions pollute the real backlog.');
  });

  it('says no reason is recorded rather than inventing one', () => {
    const panel = one('next', { records: queued });

    expect(panel.rows[2]!.why).toBe('no reason recorded');
    expect(panel.rows[2]!.reasonRecorded).toBe(false);
  });

  it('on an empty workspace says the queue is empty', () => {
    expect(one('next').empty).toBe('The queue is empty. Nothing is ranked to start next.');
  });
});

describe('needs you', () => {
  it('counts the decisions and adds up the minutes they claim to take', () => {
    const panel = one('needsYou', {
      asks: [ask({ id: 1, decisionCost: 5 }), ask({ id: 2, decisionCost: 3 })],
      pendingProposals: [],
    });

    expect(panel.figures[0]).toMatchObject({ label: 'Open decisions', value: '2' });
    expect(panel.figures[1]).toMatchObject({ label: 'Estimated minutes', value: '8 min' });
    expect(panel.figures[1]!.note).toContain('every open decision carries an estimate');
  });

  it('calls the minutes a floor when something in the queue carries no estimate', () => {
    const panel = one('needsYou', {
      asks: [ask({ id: 1, decisionCost: 5 }), ask({ id: 2 })],
      pendingProposals: [{ id: 9, title: 'Action · notify.requester', createdAt: ago(HOUR) }],
    });

    expect(panel.figures[0]!.value).toBe('3');
    expect(panel.figures[1]!.note).toBe('a floor: 2 items carry no estimate, so the real figure is higher');
  });

  it('refuses to guess how many block work when no decision names the record it holds up', () => {
    const panel = one('needsYou', { asks: [ask({ id: 1, decisionCost: 5 }), ask({ id: 2, decisionCost: 2 })] });

    expect(panel.figures.map(f => f.label)).not.toContain('Blocking work');
    expect(panel.gaps).toEqual([{
      label: 'Blocking work',
      why: 'No open decision names the record it is holding up (ask.objectRefs is empty on all 2), so how many block work is not measurable yet.',
    }]);
  });

  it('counts blocking decisions once they name their record, and calls a partial count a floor', () => {
    const panel = one('needsYou', {
      asks: [ask({ id: 1, objectRefs: [{ type: 'request', id: 40 }] }), ask({ id: 2 })],
    });

    expect(panel.figures.find(f => f.label === 'Blocking work')).toMatchObject({ value: '1' });
    expect(panel.figures.find(f => f.label === 'Blocking work')!.note).toContain('1 name nothing, so this is a floor');
  });

  it('on an empty queue reports zero and raises no gap', () => {
    const panel = one('needsYou');

    expect(panel.figures[0]).toMatchObject({ label: 'Open decisions', value: '0' });
    expect(panel.gaps.map(g => g.label)).toEqual(['Estimated minutes']);
  });
});

describe('economics', () => {
  const tasks = [
    record({ id: 1, typeSlug: 'engineering_task', status: 'accepted', meta: { costUpdatedAt: ago(2 * DAY).toISOString(), actualCents: 592 } }),
    record({ id: 2, typeSlug: 'engineering_task', status: 'accepted', meta: { costUpdatedAt: ago(3 * DAY).toISOString(), actualCents: 340 } }),
    record({ id: 3, typeSlug: 'engineering_task', status: 'rejected', meta: { costUpdatedAt: ago(4 * DAY).toISOString(), actualCents: 1185 } }),
    record({ id: 4, typeSlug: 'engineering_task', status: 'abandoned', meta: { costUpdatedAt: ago(5 * DAY).toISOString(), actualCents: 41 } }),
    record({ id: 5, typeSlug: 'engineering_task', status: 'accepted', meta: { costUpdatedAt: ago(90 * DAY).toISOString(), actualCents: 9999 } }),
  ];

  it('divides all spend in the window by what was accepted, so failed attempts are charged to the change', () => {
    const panel = one('economics', { records: tasks });
    const by = Object.fromEntries(panel.figures.map(f => [f.label, f.value]));

    expect(by['Spend, last 30 days']).toBe('$21.58');
    expect(by['Accepted changes']).toBe('2');
    expect(by['Cost per accepted change']).toBe('$10.79');
    expect(by.Waste).toBe('$12.26');
  });

  it('leaves work outside the window out of every figure', () => {
    expect(JSON.stringify(one('economics', { records: tasks }).figures)).not.toContain('99.99');
  });

  it('refuses a cost per accepted change when nothing was accepted', () => {
    const panel = one('economics', { records: tasks.filter(t => t.status !== 'accepted') });

    expect(panel.figures.map(f => f.label)).not.toContain('Cost per accepted change');
    expect(panel.gaps[0]!.why).toBe('Nothing reached accepted in the last 30 days, so there is no denominator. Spend without an accepted change is all waste, below.');
  });

  it('on an empty workspace reports zeroes and names the missing denominator', () => {
    const panel = one('economics');

    expect(panel.figures.map(f => f.value)).toEqual(['$0.00', '0', '$0.00']);
    expect(panel.gaps.map(g => g.label)).toEqual(['Cost per accepted change']);
  });
});

describe('autonomy', () => {
  const counts = { workItems: 50, needingDecision: 8, executed: 30, autoExecuted: 27, interventions: 12, approvedClean: 9 };

  it('reports work autonomy and human interruption as two separate groups, never blended', () => {
    const panel = one('autonomy', { humanLoad: load(counts) });

    expect(panel.work.map(f => [f.label, f.value])).toEqual([
      ['Handled without a person', '84%'],
      ['Executed under a trust rule', '90%'],
    ]);
    expect(panel.attention.map(f => [f.label, f.value])).toEqual([
      ['Meaningful decisions required', '12'],
      ['Escalations approved unchanged', '9'],
    ]);
    // The reassuring number is never adjacent to the count it would explain away.
    expect(panel.work.map(f => f.label)).not.toContain('Meaningful decisions required');
  });

  it('shows attention per day only from decisions that carried an estimate, and calls it a floor', () => {
    const panel = one('autonomy', {
      humanLoad: load(counts),
      asks: [
        ask({ id: 1, status: 'decided', decisionCost: 5, decidedAt: ago(1 * DAY) }),
        ask({ id: 2, status: 'decided', decisionCost: 9, decidedAt: ago(2 * DAY) }),
        ask({ id: 3, status: 'decided', decidedAt: ago(3 * DAY) }),
      ],
    });
    const perDay = panel.attention.find(f => f.label === 'Attention per day')!;

    expect(perDay.value).toBe('2 min');
    expect(perDay.note).toBe('a floor: only 2 of 3 decisions answered in the window carried a minutes estimate, and a proposal carries none');
  });

  it('refuses attention per day when nothing answered carried an estimate', () => {
    const panel = one('autonomy', { humanLoad: load(counts), asks: [ask({ id: 1, status: 'decided', decidedAt: ago(DAY) })] });

    expect(panel.attention.map(f => f.label)).not.toContain('Attention per day');
    expect(panel.gaps.map(g => g.label)).toContain('Attention per day');
  });

  it('always names unnecessary escalations as the measure nothing records', () => {
    const gap = one('autonomy', { humanLoad: load(counts) }).gaps.find(g => g.label === 'Unnecessary escalations')!;

    expect(gap.why).toContain('Nothing records whether policy COULD have decided an item without asking');
    expect(gap.why).toContain('closest honest proxy');
  });

  it('on an empty workspace divides by nothing rather than reporting 100%', () => {
    const panel = one('autonomy', { humanLoad: load() });

    expect(panel.work).toEqual([]);
    expect(panel.gaps[0]).toEqual({ label: 'Work autonomy', why: 'No work item was created in the last 7 days, so there is nothing to divide by.' });
    expect(JSON.stringify(panel)).not.toContain('100%');
  });

  it('reports nothing at all when the human-load fold could not be read', () => {
    const panel = one('autonomy', { humanLoad: null });

    expect(panel.work).toEqual([]);
    expect(panel.attention.map(f => f.label)).not.toContain('Meaningful decisions required');
  });
});

describe('the page as a whole', () => {
  it('computes the panels in the order the manifest declares them', () => {
    const manifest = PageManifestSchema.parse({
      slug: 'factory',
      title: 'Factory',
      archetype: 'overview',
      panels: [PANELS.status, PANELS.digest, PANELS.active, PANELS.next, PANELS.needsYou, PANELS.economics, PANELS.autonomy],
    });
    const page = assembleOverview({ ...input('status'), panels: manifest.panels! });

    expect(page.panels.map(p => p.kind)).toEqual(['status', 'digest', 'active', 'next', 'needsYou', 'economics', 'autonomy']);
  });

  it('hands back the stamp it measured from, so the visit can be recorded', () => {
    expect(assembleOverview(input('digest', { lastSeenAt: ago(DAY) })).lastSeenAt).toEqual(ago(DAY));
    expect(assembleOverview(input('digest')).lastSeenAt).toBeNull();
  });

  it('renders every panel on a completely empty workspace without a fabricated figure', () => {
    const manifest = PageManifestSchema.parse({
      slug: 'factory',
      title: 'Factory',
      archetype: 'overview',
      panels: [PANELS.status, PANELS.digest, PANELS.active, PANELS.next, PANELS.needsYou, PANELS.economics, PANELS.autonomy],
    });
    const page = assembleOverview({ ...input('status'), panels: manifest.panels!, humanLoad: load() });

    expect(page.panels).toHaveLength(7);

    for (const panel of page.panels) {
      if (panel.kind === 'status' || panel.kind === 'digest' || panel.kind === 'active' || panel.kind === 'next') {
        expect(panel.empty).not.toBeNull();
      }
    }
  });
});

describe('how far back the digest reached', () => {
  it('reads in minutes, hours or days, singular where it should be', () => {
    expect(describeAge(90_000)).toBe('2 minutes');
    expect(describeAge(HOUR)).toBe('1 hour');
    expect(describeAge(12 * HOUR)).toBe('12 hours');
    expect(describeAge(3 * DAY)).toBe('3 days');
  });
});
