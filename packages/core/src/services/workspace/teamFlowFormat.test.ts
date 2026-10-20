import { describe, expect, it } from 'vitest';
import { PageBlockSchema } from '@/libs/workspace/pageFields';
import { monthStart, prettySlug } from './teamFlowFormat';

describe('page team and flow blocks', () => {
  it('accepts a team block naming its team and the names its systems read as', () => {
    const block = PageBlockSchema.parse({ kind: 'team', team: 'finance', systems: { 'ledger-production': 'QuickBooks', 'ledger-sandbox': '' } });

    expect(block).toMatchObject({ kind: 'team', team: 'finance', position: 'above' });
    expect(block.systems).toEqual({ 'ledger-production': 'QuickBooks', 'ledger-sandbox': '' });
  });

  it('accepts a flow of steps, each an agent\'s or a person\'s', () => {
    const block = PageBlockSchema.parse({
      kind: 'flow',
      steps: [
        { title: 'Code the week\'s expenses', agent: 'bookkeeper', automation: 'weekly-expense-coding' },
        { title: 'Reconcile the balance sheet', agent: 'controller', cadence: 'The 5th', artifacts: [41] },
        { title: 'Approve and send', person: 'The partners', links: [{ label: 'Review', href: '/dashboard/inbox' }] },
      ],
    });

    expect(block.steps).toHaveLength(3);
    expect(block.steps![2]!.person).toBe('The partners');
  });

  it('refuses a flow with no steps, and a flow of one', () => {
    expect(PageBlockSchema.safeParse({ kind: 'flow' }).success).toBe(false);
    expect(PageBlockSchema.safeParse({ kind: 'flow', steps: [{ title: 'Only step', agent: 'bookkeeper' }] }).success).toBe(false);
  });

  it('starts the month at midnight on the 1st in the workspace\'s zone', () => {
    const { start, label } = monthStart(new Date('2026-10-20T19:00:00Z'), 'America/Los_Angeles');

    expect(start.toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(label).toBe('October 2026');
  });

  it('reads the month in the zone, not in UTC, at the turn of the month', () => {
    // 03:00 UTC on Nov 1 is still Oct 31 in Los Angeles.
    expect(monthStart(new Date('2026-11-01T03:00:00Z'), 'America/Los_Angeles').label).toBe('October 2026');
    expect(monthStart(new Date('2026-11-01T03:00:00Z'), 'UTC').start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('reads an unnamed source slug as words', () => {
    expect(prettySlug('ledger-production')).toBe('Ledger production');
    expect(prettySlug('drive')).toBe('Drive');
  });
});
