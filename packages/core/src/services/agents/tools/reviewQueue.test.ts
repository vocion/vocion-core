/**
 * The Review queue from chat (2026-10-23): read as the page shows it, by a
 * typed age window, and many declined on ONE card. Fictional fixtures.
 */
import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';
import { filterOf, renderQueue, reviewQueueTools } from './reviewQueue';

const NOW = new Date('2026-10-23T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const TARGETS = [
  { ref: 'ask:7', kind: 'approval' as const, title: 'Approve the Kestrel discount', at: daysAgo(90), agentSlug: 'deal-desk', href: '/a/7' },
  { ref: 'proposal:12', kind: 'proposal' as const, title: 'Update Lucent Labs deal stage', at: daysAgo(52), agentSlug: 'sdr-coordinator', href: '/r/12' },
];

vi.mock('@/services/inbox/queueSelection', async (orig) => {
  const real = await orig<typeof import('@/services/inbox/queueSelection')>();
  return { ...real, selectQueue: vi.fn(async () => ({ targets: TARGETS, open: 69, notDeclinable: { run: 2 } })) };
});

function ctx(over: Partial<RuntimeContext> = {}): RuntimeContext {
  return { orgId: 'org_nw', userId: 'user_dana', agentSlug: 'northwind-revenue-lead', emit: vi.fn(), ...over } as unknown as RuntimeContext;
}

describe('reading the queue', () => {
  it('takes "older than 5 days" as a lower bound in days, never a since-date', () => {
    expect(filterOf({ older_than_days: 5, kinds: ['proposal'] })).toEqual({ olderThanDays: 5, kinds: ['proposal'] });
    expect(filterOf({ newer_than_days: 7, q: '  ' })).toEqual({ newerThanDays: 7 });
  });

  it('says the total, each ref and wait, calls it the Review queue, and never asks for ids', () => {
    const out = renderQueue({ targets: TARGETS, open: 69, notDeclinable: { run: 2 } }, 'Open decisions waiting 5 days or more', NOW);

    expect(out).toContain('Review queue, this workspace: 2 of 69 open decisions match');
    expect(out).toContain('- ask:7 · Approvals · Approve the Kestrel discount · waited 90d · from deal-desk');
    expect(out).toContain('2 Runs');
    expect(out).toContain('Never ask the person for ids.');
    expect(out).not.toMatch(/inbox/i);
  });

  it('stays loaded while the person is on the Review queue, and needs a person', () => {
    const [list] = reviewQueueTools(ctx({ pageContext: { path: '/w/revenue/dashboard/inbox', title: 'Review queue' } }));

    expect((list as { metadata?: Record<string, unknown> }).metadata).toEqual({ alwaysLoaded: true });
    expect((reviewQueueTools(ctx())[0] as { metadata?: Record<string, unknown> }).metadata).toEqual({});
    expect(reviewQueueTools(ctx({ userId: undefined }))).toEqual([]);
  });
});

describe('declining from chat', () => {
  it('puts ONE card in front of the person and declines nothing itself', async () => {
    const c = ctx();
    const decline = reviewQueueTools(c)[1]!;

    const out = await decline.invoke({ older_than_days: 5, reason: 'Too old to act on.' });

    expect(c.emit).toHaveBeenCalledTimes(1);

    const event = (c.emit as ReturnType<typeof vi.fn>).mock.calls[0]![0];

    expect(event).toMatchObject({ type: 'recommended_action', recommendation: { actionId: 'review.decline', label: 'Decline 2 decisions: Open decisions waiting 5 days or more', input: { refs: ['ask:7', 'proposal:12'], reason: 'Too old to act on.' } } });
    expect(out).toContain('Nothing is declined until they approve it.');
  });

  it('narrows to refs it listed, and never reaches past the selection', async () => {
    const c = ctx();
    const decline = reviewQueueTools(c)[1]!;

    await decline.invoke({ refs: ['proposal:12', 'proposal:999'] });

    expect((c.emit as ReturnType<typeof vi.fn>).mock.calls[0]![0].recommendation.input.refs).toEqual(['proposal:12']);
  });
});
