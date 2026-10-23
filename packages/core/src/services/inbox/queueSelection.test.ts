import type { QueueTarget } from './queueSelection';
/**
 * "Older than 5 days" reads as an age window, never "the past 5 days", and a
 * count is the count of things a person decides (2026-10-23). The queue is
 * fictional: Northwind's revenue workspace.
 */
import type { InboxItem } from '@/services/InboxService';
import { describe, expect, it } from 'vitest';
import { describeFilter, inAgeWindow, pickTargets, waitedDays } from './queueSelection';

const NOW = new Date('2026-10-23T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function row(over: Partial<InboxItem>): InboxItem {
  return { key: 'x', kind: 'proposal', shape: 'single', title: 'Update Lucent Labs deal stage', agentSlug: 'sdr-coordinator', teamSlug: null, risk: null, status: 'pending', at: daysAgo(52), href: '/dashboard/inbox/r/1', ...over };
}

describe('the age window', () => {
  it('keeps what waited at least N days for older_than, and under N for newer_than', () => {
    expect(inAgeWindow(daysAgo(52), NOW, { olderThanDays: 5 })).toBe(true);
    expect(inAgeWindow(daysAgo(2), NOW, { olderThanDays: 5 })).toBe(false);
    expect(inAgeWindow(daysAgo(2), NOW, { newerThanDays: 5 })).toBe(true);
    expect(inAgeWindow(daysAgo(52), NOW, { newerThanDays: 5 })).toBe(false);
    expect(inAgeWindow(daysAgo(6), NOW, { olderThanDays: 5, newerThanDays: 7 })).toBe(true);
    expect(waitedDays(daysAgo(52), NOW)).toBe(52);
  });

  it('says the selection in the page\'s words', () => {
    expect(describeFilter({ olderThanDays: 5, kinds: ['proposal'] }, () => 'Recommendations')).toBe('Recommendations waiting 5 days or more');
    expect(describeFilter({}, () => '')).toBe('Open decisions');
  });
});

describe('picking the decisions a request means', () => {
  it('ages each row and each member of a sheet on its own, longest waiting first', () => {
    const members = new Map<string, QueueTarget[]>([['review-sheet:deal-9', [
      { ref: 'proposal:31', kind: 'proposal', title: 'Close Catalyst deal', at: daysAgo(51), agentSlug: 'sdr-coordinator', href: '/r/31' },
      { ref: 'proposal:32', kind: 'proposal', title: 'Email Catalyst', at: daysAgo(1), agentSlug: 'sdr-coordinator', href: '/r/32' },
    ]]]);
    const items = [
      row({ key: 'proposal:12', reviewId: 12, at: daysAgo(50) }),
      row({ key: 'review-sheet:deal-9', shape: 'sheet', groupKey: 'deal-9', at: daysAgo(51) }),
      row({ key: 'ask:7', kind: 'approval', askId: 7, status: 'open', at: daysAgo(90) }),
      row({ key: 'proposal:13', reviewId: 13, at: daysAgo(2) }),
      row({ key: 'run:4', kind: 'run', at: daysAgo(60) }),
    ];

    const picked = pickTargets(items, members, { olderThanDays: 5 }, NOW);

    expect(picked.targets.map(t => t.ref)).toEqual(['ask:7', 'proposal:31', 'proposal:12']);
    expect(picked.notDeclinable).toEqual({ run: 1 });
  });

  it('leaves a hand-off that is already approved out, as the page\'s batches do', () => {
    const picked = pickTargets([row({ key: 'proposal:20', reviewId: 20, status: 'awaiting_execution' })], new Map(), {}, NOW);

    expect(picked.targets).toEqual([]);
    expect(picked.notDeclinable).toEqual({ proposal: 1 });
  });
});
