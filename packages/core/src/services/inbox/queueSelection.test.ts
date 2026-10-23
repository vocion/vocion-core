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
  const queue = (items: InboxItem[], folded: Array<[string, InboxItem[]]> = []) => ({ items, folded: new Map(folded) });

  it('ages each row and each member of a sheet on its own, longest waiting first', () => {
    const members = new Map<string, QueueTarget[]>([['review-sheet:deal-9', [
      { ref: 'proposal:31', kind: 'proposal', title: 'Close Corvid Mills deal', at: daysAgo(51), agentSlug: 'sdr-coordinator', href: '/r/31' },
      { ref: 'proposal:32', kind: 'proposal', title: 'Email Corvid Mills', at: daysAgo(1), agentSlug: 'sdr-coordinator', href: '/r/32' },
    ]]]);
    const items = [
      row({ key: 'proposal:12', reviewId: 12, at: daysAgo(50) }),
      row({ key: 'review-sheet:deal-9', shape: 'sheet', groupKey: 'deal-9', at: daysAgo(51) }),
      row({ key: 'ask:7', kind: 'approval', askId: 7, status: 'open', at: daysAgo(90) }),
      row({ key: 'proposal:13', reviewId: 13, at: daysAgo(2) }),
      row({ key: 'run:4', kind: 'run', at: daysAgo(60) }),
    ];

    const picked = pickTargets(queue(items), members, { olderThanDays: 5 }, NOW);

    expect(picked.targets.map(t => t.ref)).toEqual(['ask:7', 'proposal:31', 'proposal:12']);
    expect(picked.rows).toBe(3);
    expect(picked.leftOpen).toEqual([{ kind: 'run', count: 1, why: 'a paused run is resumed or cancelled on its own page' }]);
  });

  it('leaves a hand-off that is already approved out, and says why', () => {
    const picked = pickTargets(queue([row({ key: 'proposal:20', reviewId: 20, status: 'awaiting_execution' })]), new Map(), {}, NOW);

    expect(picked.targets).toEqual([]);
    expect(picked.leftOpen).toEqual([{ kind: 'proposal', count: 1, why: 'approved and handed off: marked done or rejected on its own page' }]);
  });

  // 2026-10-23: "close work older than 7 days" left rows of 30 to 51 days on
  // the page: a suggested rule, a failed run, and rows that came back because
  // what was folded into them stayed open.
  it('takes a suggested rule and a failed run, and everything folded into a row, so the row does not come back', () => {
    const items = [
      row({ key: 'learning:5', kind: 'learning', ref: { kind: 'learning', id: 5 }, title: 'Never write "Worth a look" in outbound', at: daysAgo(37) }),
      row({ key: 'proposal:44', reviewId: 44, status: 'failed', title: 'Send the Bramblewood follow-up', at: daysAgo(44) }),
      row({ key: 'ask:7', kind: 'approval', askId: 7, status: 'open', at: daysAgo(39), chases: [8, 9] }),
      row({ key: 'proposal:12', reviewId: 12, at: daysAgo(51) }),
    ];
    // A related decision the agenda folded into proposal:12, newer than the cut-off: it goes with its row.
    const folded: Array<[string, InboxItem[]]> = [['proposal:12', [row({ key: 'proposal:14', reviewId: 14, title: 'Update the Lucent Labs close date', at: daysAgo(3) })]]];

    const picked = pickTargets(queue(items, folded), new Map(), { olderThanDays: 7 }, NOW);

    expect(picked.targets.map(t => t.ref).sort()).toEqual(['ask:7', 'ask:8', 'ask:9', 'learning:5', 'proposal:12', 'proposal:14', 'proposal:44'].sort());
    expect(picked.targets.filter(t => t.folded).map(t => t.ref).sort()).toEqual(['ask:8', 'ask:9', 'proposal:14']);
    expect(picked.rows).toBe(4);
    expect(picked.leftOpen).toEqual([]);
  });

  it('counts what a decline cannot take by kind and why, and never drops it', () => {
    const members = new Map<string, Array<QueueTarget & { status?: string }>>([['review-sheet:deal-3', [
      { ref: 'proposal:61', kind: 'proposal', title: 'Close Harbor Kiln deal', at: daysAgo(40), agentSlug: null, href: '/r/61', status: 'awaiting_execution' },
      { ref: 'proposal:62', kind: 'proposal', title: 'Update Harbor Kiln owner', at: daysAgo(40), agentSlug: null, href: '/r/62', status: 'pending' },
    ]]]);
    const items = [
      row({ key: 'review-sheet:deal-3', shape: 'sheet', groupKey: 'deal-3', at: daysAgo(40) }),
      row({ key: 'worker:3', kind: 'exception', at: daysAgo(30) }),
      row({ key: 'worker:4', kind: 'exception', at: daysAgo(31) }),
      row({ key: 'plan:2', kind: 'approval', at: daysAgo(20) }),
    ];

    const picked = pickTargets(queue(items), members, { olderThanDays: 7 }, NOW);

    expect(picked.targets.map(t => t.ref)).toEqual(['proposal:62']);
    expect(picked.leftOpen).toEqual([
      { kind: 'exception', count: 2, why: 'a failure is retried or dismissed on its own page' },
      { kind: 'proposal', count: 1, why: 'approved and handed off: marked done or rejected on its own page' },
      { kind: 'approval', count: 1, why: 'decided on its own page' },
    ]);
  });
});
