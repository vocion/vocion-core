import type { AutomationRunInput, BriefingRowInput } from './appFront';
import type { BriefingV2 } from '@/services/briefings/document';
import { describe, expect, it } from 'vitest';
import { attentionCounts, failedRunAfter, frontBriefing, pickAppBriefing, topMoves } from './appFront';

const TZ = 'America/Los_Angeles';
const NOW = new Date('2026-10-29T17:00:00Z'); // Thu, Oct 29, 10:00 Pacific

function brief(over: Partial<BriefingRowInput> & { id: number }): BriefingRowInput {
  return { title: `Brief ${over.id}`, createdAt: NOW, teamSlug: 'pipeline', document: null, missionRunId: null, ...over };
}

function doc(over: Partial<BriefingV2>): BriefingV2 {
  return { version: 2, title: 'Pipeline Briefing', dateLabel: 'Thu, Oct 29', updatedLabel: '7:00 AM', teamSlug: 'pipeline', composedFrom: [], ...over } as BriefingV2;
}

function decision(title: string, n: number) {
  return { key: `d${n}`, ref: { kind: 'proposal' as const, id: n }, href: `/dashboard/inbox/proposal-${n}`, kind: 'proposal' as const, title, whyNow: 'It waits on you.', evidence: [], lane: 'judgment' as const, incident: false, risk: null, amount: null, currency: null };
}

function run(over: Partial<AutomationRunInput> & { id: number; startedAt: Date }): AutomationRunInput {
  return { slug: 'morning-brief', kind: 'mission_check', status: 'ok', finishedAt: new Date(over.startedAt.getTime() + 5 * 60_000), targetRunId: over.id * 10, ...over };
}

describe('pickAppBriefing', () => {
  const rows = [
    brief({ id: 1, teamSlug: 'ads', createdAt: new Date('2026-10-29T16:00:00Z') }),
    brief({ id: 2, teamSlug: 'pipeline', createdAt: new Date('2026-10-28T14:00:00Z') }),
    brief({ id: 3, teamSlug: null, createdAt: new Date('2026-10-29T16:30:00Z') }),
    brief({ id: 4, teamSlug: 'deals', createdAt: new Date('2026-10-27T14:00:00Z') }),
  ];

  it('takes the newest brief of the app\'s teams, never another app\'s or the rollup', () => {
    expect(pickAppBriefing(rows, ['pipeline', 'deals'])?.id).toBe(2);
  });

  it('has nothing for an app whose teams published nothing', () => {
    expect(pickAppBriefing(rows, ['followups'])).toBeNull();
    expect(pickAppBriefing(rows, [])).toBeNull();
  });
});

describe('frontBriefing', () => {
  it('says Today for a brief from the workspace\'s today, with its headline, decisions and moves', () => {
    const row = brief({
      id: 7,
      createdAt: new Date('2026-10-29T14:05:00Z'),
      document: doc({
        today: { summary: 'Two renewals slipped; Northwind wants a revised scope.', metrics: [] },
        decisions: { judgment: [decision('Approve the Northwind scope', 1), decision('Send the Kestrel Capital follow-up', 2)], queued: { batchable: 0, background: 0 }, href: '/dashboard/inbox' },
      }),
    });
    const f = frontBriefing(row, { now: NOW, timeZone: TZ, runs: [] });

    expect(f).toMatchObject({ id: 7, href: '/dashboard/briefings/7', today: true, headline: 'Two renewals slipped; Northwind wants a revised scope.', decisions: 2, failedRun: null });
    expect(f.moves).toEqual(['Approve the Northwind scope', 'Send the Kestrel Capital follow-up']);
  });

  it('dates a brief from another day in the workspace\'s zone', () => {
    // 06:00 UTC on the 24th is still Fri the 23rd in Pacific.
    const f = frontBriefing(brief({ id: 8, createdAt: new Date('2026-10-24T06:00:00Z') }), { now: NOW, timeZone: TZ, runs: [] });

    expect(f.today).toBe(false);
    expect(f).toMatchObject({ publishedAt: '2026-10-24T06:00:00.000Z', timeZone: TZ });
  });

  it('shrinks with the brief: a markdown-only brief has no headline, decisions or moves', () => {
    const f = frontBriefing(brief({ id: 9 }), { now: NOW, timeZone: TZ, runs: [] });

    expect(f).toMatchObject({ headline: null, decisions: 0, moves: [] });
  });

  it('says a stale brief\'s run failed, and a brief from today never', () => {
    const published = new Date('2026-10-28T14:03:00Z');
    const runs = [
      run({ id: 1, startedAt: new Date('2026-10-28T14:00:00Z') }),
      run({ id: 2, startedAt: new Date('2026-10-29T12:00:00Z'), status: 'error' }),
    ];

    expect(frontBriefing(brief({ id: 10, createdAt: published, missionRunId: 10 }), { now: NOW, timeZone: TZ, runs }).failedRun).toEqual({ href: '/dashboard/missions/runs/20' });
    expect(frontBriefing(brief({ id: 11, createdAt: new Date('2026-10-29T14:03:00Z'), missionRunId: 10 }), { now: NOW, timeZone: TZ, runs }).failedRun).toBeNull();
  });
});

describe('failedRunAfter', () => {
  const published = new Date('2026-10-28T14:03:00Z');
  const brief = { createdAt: published, missionRunId: 10 };
  // The automation run that dispatched mission run 10 wrote the brief.
  const writer = run({ id: 1, startedAt: new Date('2026-10-28T14:00:00Z') });

  it('blames the brief\'s own automation when its next run failed', () => {
    expect(failedRunAfter(brief, [writer, run({ id: 2, startedAt: new Date('2026-10-29T12:00:00Z'), status: 'error' })])).toEqual({ href: '/dashboard/missions/runs/20' });
  });

  it('is null when the writer\'s next run succeeded or is still going', () => {
    expect(failedRunAfter(brief, [writer, run({ id: 2, startedAt: new Date('2026-10-29T12:00:00Z') })])).toBeNull();
    expect(failedRunAfter(brief, [writer, run({ id: 2, startedAt: new Date('2026-10-29T12:00:00Z'), status: 'running', finishedAt: null })])).toBeNull();
  });

  it('never blames another automation that was running when the brief was published', () => {
    // A watchdog in flight over the publish, then failing, is not the writer.
    const watchdog = run({ id: 3, slug: 'watchdog', targetRunId: 99, startedAt: new Date('2026-10-28T13:59:00Z'), finishedAt: new Date('2026-10-28T14:30:00Z') });
    const watchdogFailed = run({ id: 4, slug: 'watchdog', targetRunId: 98, startedAt: new Date('2026-10-29T11:00:00Z'), status: 'error' });

    expect(failedRunAfter(brief, [watchdog, writer, watchdogFailed])).toBeNull();
    // …and the real writer's failure is still found behind it.
    expect(failedRunAfter(brief, [watchdog, writer, watchdogFailed, run({ id: 5, startedAt: new Date('2026-10-29T12:00:00Z'), status: 'error' })])).toEqual({ href: '/dashboard/missions/runs/50' });
  });

  it('is null for a brief published outside a mission run, or whose writer is gone', () => {
    const failed = run({ id: 2, startedAt: new Date('2026-10-29T12:00:00Z'), status: 'error' });

    expect(failedRunAfter({ createdAt: published, missionRunId: null }, [writer, failed])).toBeNull();
    expect(failedRunAfter(brief, [failed])).toBeNull();
  });

  it('links a later failure with no run of its own to the run log', () => {
    const failed = run({ id: 2, kind: 'job', startedAt: new Date('2026-10-29T12:00:00Z'), status: 'error', targetRunId: null });

    expect(failedRunAfter(brief, [writer, failed])).toEqual({ href: '/dashboard/schedules/runs?slug=morning-brief&status=error' });
  });
});

describe('topMoves', () => {
  it('takes the decisions, then today\'s critical path, three at most, each once', () => {
    const moves = topMoves(doc({
      decisions: { judgment: [decision('Approve the Northwind scope', 1)], queued: { batchable: 0, background: 0 }, href: '/dashboard/inbox' },
      criticalPath: { items: [
        { at: '14:00', order: 2, label: 'Contoso Supply renewal call', evidence: [] },
        { at: '11:00', order: 1, label: 'Approve the Northwind scope', evidence: [] },
        { at: '16:00', order: 3, label: 'Bellwater Hall walkthrough', evidence: [] },
      ] },
    }));

    expect(moves).toEqual(['Approve the Northwind scope', 'Contoso Supply renewal call', 'Bellwater Hall walkthrough']);
  });
});

describe('attentionCounts', () => {
  const agents = ['pipeline-lead', 'writer'];
  const opts = {
    label: (id: string) => ({ 'mail.send': 'Send email', 'leads.enroll': 'Enroll lead', 'crm.update': 'Update record', 'crm.create': 'Create record' }[id] ?? id),
    surfaceFor: (id: string) => (id === 'leads.enroll' ? '/gtm/leads' : null),
  };

  it('counts the rows this app\'s agents left waiting, per kind, largest first, linked to exactly those rows', () => {
    const items = [
      { agentSlug: 'writer', actionId: 'mail.send' },
      { agentSlug: 'writer', actionId: 'mail.send' },
      { agentSlug: 'writer', actionId: 'mail.send' },
      { agentSlug: 'pipeline-lead', actionId: 'leads.enroll' },
    ];
    const { counts, more } = attentionCounts(items, agents, opts);

    expect(counts).toEqual([
      { key: 'mail.send', label: 'Send email', count: 3, href: '/dashboard/inbox?agents=pipeline-lead%2Cwriter&actionKind=mail.send' },
      { key: 'leads.enroll', label: 'Enroll lead', count: 1, href: '/gtm/leads' },
    ]);
    expect(more).toBeNull();
  });

  it('counts rows, the unit Review counts: a sheet of several questions is one row', () => {
    const { counts } = attentionCounts([{ agentSlug: 'writer', actionId: 'mail.send', count: 5 } as { agentSlug: string; actionId: string }], agents, opts);

    expect(counts[0]?.count).toBe(1);
  });

  it('counts by agent only, so every counted row is behind its agents= link; the rest wait outside the app', () => {
    const items = [
      { agentSlug: 'writer', actionId: 'mail.send' },
      // An item of another app's agent, and one with no agent at all.
      { agentSlug: 'ads-lead', actionId: 'mail.send' },
      { agentSlug: null, actionId: 'crm.update' },
    ];
    const { counts, more, outside } = attentionCounts(items, agents, opts);

    expect(counts.map(c => [c.key, c.count])).toEqual([['mail.send', 1]]);
    expect(more).toBeNull();
    expect(outside).toEqual({ count: 2, href: '/dashboard/inbox' });
  });

  it('folds kinds past three, and rows with no action, into "more" in Review', () => {
    const items = [
      ...['mail.send', 'mail.send', 'leads.enroll', 'crm.update', 'crm.create'].map(actionId => ({ agentSlug: 'writer', actionId })),
      { agentSlug: 'writer' },
    ];
    const { counts, more, outside } = attentionCounts(items, agents, opts);

    expect(counts.map(c => c.key)).toEqual(['mail.send', 'crm.create', 'crm.update']);
    expect(more).toEqual({ count: 2, href: '/dashboard/inbox?agents=pipeline-lead%2Cwriter' });
    expect(outside).toBeNull();
  });

  it('is empty when nothing of this app waits, and still says what waits outside it', () => {
    expect(attentionCounts([{ agentSlug: 'ads-lead', actionId: 'mail.send' }], agents, opts)).toEqual({ counts: [], more: null, outside: { count: 1, href: '/dashboard/inbox' } });
    expect(attentionCounts([], agents, opts)).toEqual({ counts: [], more: null, outside: null });
  });
});
