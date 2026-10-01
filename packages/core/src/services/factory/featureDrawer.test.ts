import type { FeatureDrawerKey, FeatureReportInput } from './featureReport';
import { describe, expect, it } from 'vitest';
import { evidenceHref, featureDrawer, featureDrawerId, parseFeatureDrawerId } from './featureDrawer';
import { assembleFeatureReport } from './featureReport';

/**
 * The feature page's drawers: each says what the page only summarises, and
 * says each thing once — the title in the pane's header, the status in the
 * one line under it, every reason named where it is mentioned, every
 * reference a link in words (Chris, 2026-09-28). Fixtures are fictional (the
 * cast in `libs/fixtures/realDataGuard.ts`).
 */

const T = (iso: string) => new Date(iso);
const NOW = T('2026-09-21T12:00:00Z');

function report(over: Partial<FeatureReportInput> = {}) {
  const base: FeatureReportInput = {
    request: {
      id: 41,
      title: 'Export a room as a PDF',
      status: 'in_scope',
      createdAt: T('2026-09-01T09:00:00Z'),
      meta: { state: 'building', body: 'Give me a PDF of the room.', askedBy: { name: 'Dana Okafor' }, acceptance: [{ statement: 'The share menu offers PDF', met: true, evidenceUrl: '/dashboard/artifacts/700' }, { statement: 'Every section is in order' }] },
    },
    // Paths across two packages and into a migration: the plan rule requires a plan, for two reasons.
    tasks: [{ id: 77, title: 'Room PDF export', status: 'awaiting_review', createdAt: T('2026-09-03T09:00:00Z'), meta: { requestId: 41, objective: 'Add a PDF export.', allowedPaths: ['src/features/rooms/**', 'migrations/**'], prUrl: 'https://github.com/example/northwind-portal/pull/12' } }],
    plans: [{ id: 31, title: 'Render server side', status: 'candidate', createdAt: T('2026-09-02T17:00:00Z'), meta: { requestId: 41, approach: 'Render from the room model. Not the DOM.', approvedBy: 'Chris', approvedAt: '2026-09-02T18:00:00Z', components: ['a renderer', 'a menu entry'], risks: ['Fonts differ from the screen, and every exported room looks off'], verification: 'Export the fixture room and diff the sections.' } }],
    workerRuns: [
      { id: 500, agentSlug: 'task-engineer', kind: 'worker', status: 'failed', attempt: 1, cents: 120, model: 'claude-sonnet-4-6', summary: null, error: 'verification failed: typecheck failed', createdAt: T('2026-09-03T10:00:00Z'), claimedAt: T('2026-09-03T10:01:00Z'), completedAt: T('2026-09-03T10:30:00Z'), input: {}, result: { checks: [{ name: 'typecheck', passed: false }, { name: 'lint', passed: true }] }, progress: {} },
      { id: 501, agentSlug: 'task-engineer', kind: 'worker', status: 'completed', attempt: 2, cents: 309, model: 'claude-sonnet-4-6', summary: 'Added the export.', error: null, createdAt: T('2026-09-04T10:00:00Z'), claimedAt: T('2026-09-04T10:01:00Z'), completedAt: T('2026-09-04T11:00:00Z'), input: {}, result: { pr_url: 'https://github.com/example/northwind-portal/pull/12', checks: [{ name: 'typecheck', passed: true }, { name: 'lint', passed: true }] }, progress: {} },
    ],
    asks: [],
    actionRuns: [],
    releases: [],
    artifacts: [],
    now: NOW,
  };
  return {
    ...assembleFeatureReport({ ...base, ...over }),
    activity: [
      { kind: 'conversation' as const, id: 12, title: 'Scoping the export', at: T('2026-09-02T09:00:00Z'), status: 'wrote', detail: null },
      { kind: 'mission_run' as const, id: 88, title: 'RUN-88', at: T('2026-09-05T09:00:00Z'), status: 'completed', detail: '3 steps' },
    ],
  };
}

/**
 * How many times a phrase appears in a drawer, title and line and facts and body together.
 * @param key
 * @param phrase
 * @param r
 */
function count(key: FeatureDrawerKey, phrase: string, r = report()): number {
  const d = featureDrawer(r, key, NOW)!;
  const all = [d.title, d.subtitle ?? '', ...(d.facts ?? []).flatMap(f => [f.label, f.value]), d.body].join('\n');
  return all.split(phrase).length - 1;
}

describe('drawer ids', () => {
  it('round-trips, and refuses anything that is not a known drawer', () => {
    expect(parseFeatureDrawerId(featureDrawerId(41, 'plan'))).toEqual({ requestId: 41, key: 'plan' });
    expect(parseFeatureDrawerId('41.criterion-2')).toEqual({ requestId: 41, key: 'criterion-2' });
    expect(parseFeatureDrawerId('41.everything')).toBeNull();
    expect(parseFeatureDrawerId('abc.plan')).toBeNull();
  });
});

describe('the plan drawer (Chris, 2026-09-28, #126: the title and status twice, reasons "listed below" and none listed)', () => {
  it('is titled once, carries one status line, and lists the reasons in the sentence that names them', () => {
    const d = featureDrawer(report(), 'plan', NOW)!;

    expect(d.title).toBe('Plan');
    expect(d.subtitle).toBe('Approved by Chris · 02 Sep 2026, 18:00 UTC');
    expect(d.facts).toBeUndefined();
    expect(d.body).toMatch(/^A plan was required because the allowed paths span 2 packages \(src, migrations\), so an architectural boundary is being crossed and the allowed paths reach a database migration\./);
    expect(d.body).not.toMatch(/listed below|reasons, listed/);
  });

  it('then the approach, what changes, the risks and the plan record — in that order', () => {
    const d = featureDrawer(report(), 'plan', NOW)!;
    const order = ['## Approach', 'Render from the room model.', '## What changes', '1. a renderer', '2. a menu entry', '## Risks', '- Fonts differ from the screen', '[Open the plan record](/dashboard/objects/31)'];

    expect(order.map(s => d.body.indexOf(s))).toEqual([...order.map(s => d.body.indexOf(s))].sort((a, b) => a - b));
    expect(order.every(s => d.body.includes(s))).toBe(true);
    expect(d.href).toBe('/dashboard/objects/31');
  });

  it('says the status and the approver once, and the plan\'s title not at all', () => {
    expect(count('plan', 'Approved')).toBe(1);
    expect(count('plan', 'Chris')).toBe(1);
    expect(count('plan', 'Render server side')).toBe(0);
    expect(count('plan', 'Export a room as a PDF')).toBe(0);
  });

  it('with no plan, says so in its one line and names the reasons it was needed', () => {
    const d = featureDrawer(report({ plans: [] }), 'plan', NOW)!;

    expect(d.subtitle).toBe('A plan was required and none is on the record.');
    expect(d.body).toContain('A plan was required because the allowed paths span 2 packages');
    expect(d.href).toBeUndefined();
  });
});

describe('the implementation drawer', () => {
  it('lists every run as a row, newest first: status, which attempt, cost, pull request, checks and why it stopped, each opening in the pane', () => {
    const d = featureDrawer(report(), 'implementation', NOW)!;

    expect(d.title).toBe('Implementation');
    expect(d.subtitle).toBe('2 attempts · $4.29 spent · Not estimated');
    expect(d.body.indexOf('[RUN-501 · Completed](?preview=worker_run:501)')).toBeLessThan(d.body.indexOf('[RUN-500 · Failed](?preview=worker_run:500)'));
    expect(d.body).toContain('**[RUN-501 · Completed](?preview=worker_run:501)** · attempt 2 of 2 · 04 Sep 2026, 11:00 UTC · $3.09\n- Pull request: [northwind-portal#12](https://github.com/example/northwind-portal/pull/12)\n- Checks: 2 passed');
    expect(d.body).toContain('**[RUN-500 · Failed](?preview=worker_run:500)** · attempt 1 of 2 · 03 Sep 2026, 10:30 UTC · $1.20\n- Checks: 1 failed (typecheck), 1 passed\n- Why it stopped: typecheck failed');
    // Nothing is running, so nothing leads.
    expect(d.body).not.toContain('## Running now');
    expect(d.href).toBe('/dashboard/p/runs/501');
  });

  it('then the five delivery facts, each a link to its evidence', () => {
    const d = featureDrawer(report(), 'implementation', NOW)!;

    expect(d.facts).toBeUndefined();
    expect(d.body).toContain([
      '## Where it stands',
      '',
      '- **Run completed:** [Yes](/dashboard/p/runs/501)',
      '- **Checks passed:** [Passed](/dashboard/p/runs/501)',
      '- **Merged:** [Not recorded as merged](https://github.com/example/northwind-portal/pull/12)',
      '- **Acceptance verified:** [1 of 2](?preview=feature_section:41.acceptance)',
      '- **Released:** [No](?preview=feature_section:41.release)',
    ].join('\n'));
    expect(d.body.indexOf('## Attempts')).toBeLessThan(d.body.indexOf('## Where it stands'));
  });

  it('prints the pull request once per attempt that opened it, never as a bare URL', () => {
    expect(count('implementation', '](https://github.com/example/northwind-portal/pull/12)')).toBe(2);
    expect(featureDrawer(report(), 'implementation', NOW)!.body).not.toMatch(/\[https:\/\//);
  });
});

describe('the other drawers say each thing once', () => {
  it('status: the sentence is the line; the delivery facts are not repeated here', () => {
    const d = featureDrawer(report(), 'status', NOW)!;

    expect(d.title).toBe('Delivery status');
    expect(d.facts).toBeUndefined();
    expect(d.body).not.toContain('Where it is');
    expect(d.body).toContain('## Stage');
  });

  it('acceptance: each criterion with its state, the evidence as a peek, and how it is reviewed', () => {
    const d = featureDrawer(report(), 'acceptance', NOW)!;

    expect(d.title).toBe('Acceptance');
    expect(d.subtitle).toBe('1 of 2 verified · still a draft');
    expect(d.body).toContain('**Passed** — The share menu offers PDF ([evidence](?preview=artifact:700))');
    expect(d.body).toContain('**Unverified** — Every section is in order');
    expect(d.body).toContain('Export the fixture room and diff the sections.');
  });

  it('one criterion: its evidence, or plainly none', () => {
    expect(featureDrawer(report(), 'criterion-0', NOW)!.body).toContain('[open it](?preview=artifact:700)');
    expect(featureDrawer(report(), 'criterion-1', NOW)!.body).toContain('No evidence is attached');
    expect(featureDrawer(report(), 'criterion-9', NOW)).toBeNull();
  });

  it('release: says where it stands once — not as a line, a fact and a paragraph', () => {
    const d = featureDrawer(report(), 'release', NOW)!;

    expect(d.title).toBe('Release');
    expect(d.subtitle).toBe('Nothing has merged yet, so nothing can be live.');
    expect(d.facts).toBeUndefined();
    expect(count('release', 'Not released')).toBe(0);

    const merged = report({ tasks: [{ id: 77, title: 'Room PDF export', status: 'accepted', createdAt: T('2026-09-03T09:00:00Z'), meta: { requestId: 41, prUrl: 'https://github.com/example/northwind-portal/pull/12', commitSha: 'abc1234' } }] });

    expect(featureDrawer(merged, 'release', NOW)!.subtitle).not.toBe(d.subtitle);
  });

  it('work: every conversation and run, each a peek, a run with no title named as what it is', () => {
    const d = featureDrawer(report(), 'work', NOW)!;

    expect(d.subtitle).toBe('1 conversation and 1 run tied to this work, newest first');
    expect(d.body).toContain('[Scoping the export](?preview=conversation:12)');
    expect(d.body).toContain('[RUN-88](?preview=mission_run:88)');
    expect(d.body).not.toContain('Mission run 88');
  });

  it('activity: the whole timeline, oldest first, each run linked to its page', () => {
    const d = featureDrawer(report(), 'activity', NOW)!;

    expect(d.body.indexOf('Asked by Dana Okafor')).toBeLessThan(d.body.indexOf('Run 501'));
    expect(d.body).toMatch(/\[Run 501 · task-engineer · attempt 2 · completed\]\(\/dashboard\/p\/runs\/501\)/);
    expect(d.body).toContain('[Pull request northwind-portal#12](https://github.com/example/northwind-portal/pull/12)');
  });

  it('a run still going leads the drawer as its own row (Chris, 2026-09-29: "Why doesn\'t that show up?")', () => {
    const r = report();
    const live = { ...r.implementation.attempts[0]!, runId: 502, n: 3, outcome: 'Running', live: true, ago: '4 min ago' };
    const d = featureDrawer({ ...r, implementation: { ...r.implementation, attempts: [live, ...r.implementation.attempts] } }, 'implementation', NOW)!;

    expect(d.body.indexOf('## Running now')).toBeLessThan(d.body.indexOf('## Runs, newest first'));
    expect(d.body).toContain('## Running now\n\n- [RUN-502 · Running](?preview=worker_run:502) · attempt 3 of 3 · started 4 min ago');
  });

  it('cost: the spend is the line, not the line and the body; each attempt links its run', () => {
    const d = featureDrawer(report(), 'cost', NOW)!;

    expect(d.subtitle).toBe('$4.29 spent · Not estimated');
    expect(d.body).not.toContain('**Spent:**');
    expect(d.body).toContain('- [RUN-501 · Completed](/dashboard/p/runs/501): $3.09');
    expect(d.body).toContain('- [RUN-500 · Failed](/dashboard/p/runs/500): $1.20');
  });

  it('details: the ask, triage, the contracts and the approvals, the asked date said once', () => {
    const d = featureDrawer(report(), 'details', NOW)!;

    for (const heading of ['## The ask', '## Triage', '## The contract', '## Approvals']) {
      expect(d.body).toContain(heading);
    }

    expect(count('details', '01 Sep 2026, 09:00 UTC')).toBe(1);
  });

  it('no drawer repeats the feature\'s name, which the page it opens on already carries', () => {
    for (const key of ['status', 'plan', 'implementation', 'acceptance', 'release', 'activity', 'work', 'cost', 'details'] as const) {
      expect(featureDrawer(report(), key, NOW)!.title).not.toContain('Export a room as a PDF');
    }
  });
});

describe('evidence links', () => {
  it('become peeks when the pane can show them, and stay links otherwise', () => {
    expect(evidenceHref('/dashboard/artifacts/700')).toBe('?preview=artifact:700');
    expect(evidenceHref('/dashboard/p/runs/501')).toBe('?preview=worker_run:501');
    expect(evidenceHref('https://files.example/qa.png')).toBe('https://files.example/qa.png');
  });
});
