import type { AutomationRunInput, BriefingRowInput } from './appFront';
import type { BriefingV2 } from '@/services/briefings/document';
import { describe, expect, it } from 'vitest';
import { attentionCounts, attentionPrompt, briefDayLabel, failedRunAfter, frontBriefing, pickAppBriefing, topMoves } from './appFront';

const TZ = 'America/Los_Angeles';
const NOW = new Date('2026-10-29T17:00:00Z'); // Thu, Oct 29, 10:00 Pacific

function brief(over: Partial<BriefingRowInput> & { id: number }): BriefingRowInput {
  return { title: `Brief ${over.id}`, createdAt: NOW, teamSlug: 'pipeline', document: null, ...over };
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
    expect(f.dateLabel).toBe('Fri, Oct 23');
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

    expect(frontBriefing(brief({ id: 10, createdAt: published }), { now: NOW, timeZone: TZ, runs }).failedRun).toEqual({ href: '/dashboard/missions/runs/20' });
    expect(frontBriefing(brief({ id: 11, createdAt: new Date('2026-10-29T14:03:00Z') }), { now: NOW, timeZone: TZ, runs }).failedRun).toBeNull();
  });
});

describe('failedRunAfter', () => {
  const published = new Date('2026-10-28T14:03:00Z');
  const writer = run({ id: 1, startedAt: new Date('2026-10-28T14:00:00Z') });

  it('is null when the writer\'s next run succeeded or is still going', () => {
    expect(failedRunAfter(published, [writer, run({ id: 2, startedAt: new Date('2026-10-29T12:00:00Z') })])).toBeNull();
    expect(failedRunAfter(published, [writer, run({ id: 2, startedAt: new Date('2026-10-29T12:00:00Z'), status: 'running', finishedAt: null })])).toBeNull();
  });

  it('reads only the automation that wrote the brief', () => {
    const other = run({ id: 3, slug: 'crm-sweep', startedAt: new Date('2026-10-29T12:00:00Z'), status: 'error' });

    expect(failedRunAfter(published, [writer, other])).toBeNull();
  });

  it('is null when no run was going when the brief was published', () => {
    expect(failedRunAfter(published, [run({ id: 2, startedAt: new Date('2026-10-29T12:00:00Z'), status: 'error' })])).toBeNull();
  });

  it('links a failed job to its run log when it has no run of its own', () => {
    const job = run({ id: 1, kind: 'job', slug: 'brief job', startedAt: new Date('2026-10-28T14:00:00Z'), targetRunId: null });
    const failed = run({ id: 2, kind: 'job', slug: 'brief job', startedAt: new Date('2026-10-29T12:00:00Z'), status: 'error', targetRunId: null });

    expect(failedRunAfter(published, [job, failed])).toEqual({ href: '/dashboard/automation/runs?slug=brief%20job&status=error' });
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
  const scope = { agents: ['pipeline-lead', 'writer'], teams: ['pipeline'] };
  const opts = {
    label: (id: string) => ({ 'mail.send': 'Send email', 'leads.enroll': 'Enroll lead', 'crm.update': 'Update record', 'crm.create': 'Create record' }[id] ?? id),
    surfaceFor: (id: string) => (id === 'leads.enroll' ? '/gtm/leads' : null),
  };

  it('counts only what this app\'s agents and teams left waiting, per kind, largest first', () => {
    const items = [
      { agentSlug: 'writer', teamSlug: null, actionId: 'mail.send' },
      { agentSlug: 'writer', teamSlug: null, actionId: 'mail.send', count: 5 },
      { agentSlug: 'pipeline-lead', teamSlug: null, actionId: 'leads.enroll' },
      { agentSlug: 'ads-lead', teamSlug: null, actionId: 'mail.send' },
      { agentSlug: null, teamSlug: 'pipeline', actionId: 'leads.enroll' },
    ];
    const { counts, more } = attentionCounts(items, scope, opts);

    expect(counts).toEqual([
      { key: 'mail.send', label: 'Send email', count: 6, href: '/dashboard/inbox?agents=pipeline-lead%2Cwriter&actionKind=mail.send' },
      { key: 'leads.enroll', label: 'Enroll lead', count: 2, href: '/gtm/leads' },
    ]);
    expect(more).toBeNull();
  });

  it('folds kinds past three, and items with no action, into "more" in Review', () => {
    const items = [
      ...['mail.send', 'mail.send', 'leads.enroll', 'crm.update', 'crm.create'].map(actionId => ({ agentSlug: 'writer', teamSlug: null, actionId })),
      { agentSlug: 'writer', teamSlug: null },
    ];
    const { counts, more } = attentionCounts(items, scope, opts);

    expect(counts.map(c => c.key)).toEqual(['mail.send', 'crm.create', 'crm.update']);
    expect(more).toEqual({ count: 2, href: '/dashboard/inbox?agents=pipeline-lead%2Cwriter' });
  });

  it('is empty when nothing of this app waits', () => {
    expect(attentionCounts([{ agentSlug: 'ads-lead', teamSlug: 'ads', actionId: 'mail.send' }], scope, opts)).toEqual({ counts: [], more: null });
  });
});

describe('attentionPrompt', () => {
  it('names the brief it starts from, by its day', () => {
    expect(attentionPrompt({ title: 'Pipeline Briefing', today: true, dateLabel: 'Thu, Oct 29' })).toContain('today\'s briefing ("Pipeline Briefing")');
    expect(attentionPrompt({ title: 'Pipeline Briefing', today: false, dateLabel: 'Fri, Oct 23' })).toContain('the Fri, Oct 23 briefing');
    expect(attentionPrompt(null)).toMatch(/^What needs my attention today\? Start from what is waiting on me in Review/);
  });

  it('formats a day the way the front shows it', () => {
    expect(briefDayLabel(new Date('2026-10-23T18:00:00Z'), TZ)).toBe('Fri, Oct 23');
  });
});
