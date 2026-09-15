import { describe, expect, it } from 'vitest';
import { shortcutFor } from '@/features/review/reviewShortcuts';
import { INBOX_KINDS } from '@/services/InboxService';
import { DECISION_VERBS, rowVerbs, verbForShortcut } from './decisionVerbs';

/**
 * One decision model: every kind has a primary, the keyboard maps onto the
 * same verbs the sticky bar shows, and the row's quick verbs are a subset of
 * the screen's.
 */
describe('DECISION_VERBS', () => {
  it('names a primary verb for every kind, and every row verb is one the screen also offers', () => {
    for (const kind of INBOX_KINDS) {
      const v = DECISION_VERBS[kind];

      expect(v.primary.label.length).toBeGreaterThan(0);

      const screen = new Set([v.primary.id, ...v.secondary.map(s => s.id)]);
      for (const r of v.row) {
        // An ask's row verbs stand in for its options, which the bar submits.
        if (kind === 'proposal' || kind === 'learning') {
          expect(screen.has(r.id)).toBe(true);
        }
      }
    }
  });

  it('maps a / d / s to the kind-appropriate verb, and to nothing where the kind has no such verb', () => {
    const approve = shortcutFor({ key: 'a' })!;
    const decline = shortcutFor({ key: 'd' })!;
    const snooze = shortcutFor({ key: 's' })!;

    expect(verbForShortcut('proposal', approve)).toMatchObject({ id: 'approve', label: 'Approve' });
    expect(verbForShortcut('proposal', decline)).toMatchObject({ id: 'reject', label: 'Decline', tone: 'danger' });
    expect(verbForShortcut('proposal', snooze)).toMatchObject({ id: 'snooze' });

    expect(verbForShortcut('run', approve)).toMatchObject({ id: 'resume', label: 'Resume' });
    expect(verbForShortcut('run', decline)).toMatchObject({ id: 'cancel' });
    expect(verbForShortcut('run', snooze)).toBeNull();

    expect(verbForShortcut('learning', approve)).toMatchObject({ id: 'approve', label: 'Adopt as rule' });
    expect(verbForShortcut('learning', decline)).toMatchObject({ id: 'reject' });

    // An ask's options are chosen, not approved: no single-key decision.
    expect(verbForShortcut('ruling', approve)).toBeNull();
    expect(verbForShortcut('approval', decline)).toBeNull();
  });

  it('never fires a verb for the queue keys or while typing', () => {
    expect(verbForShortcut('proposal', shortcutFor({ key: 'j' })!)).toBeNull();
    expect(verbForShortcut('proposal', shortcutFor({ key: 'k' })!)).toBeNull();
    expect(shortcutFor({ key: 'a', target: { tagName: 'TEXTAREA' } })).toBeNull();
    expect(shortcutFor({ key: 'a', metaKey: true })).toBeNull();
  });

  it('gives a sheet no quick verbs (it opens), a run none (it resumes from its screen), and a proposal Approve · Decline', () => {
    expect(rowVerbs('proposal', 'sheet')).toEqual([]);
    expect(rowVerbs('merge', 'sheet')).toEqual([]);
    expect(rowVerbs('run', 'single')).toEqual([]);
    expect(rowVerbs('proposal', 'single').map(v => v.label)).toEqual(['Approve', 'Decline']);
    expect(rowVerbs('learning', 'single').map(v => v.label)).toEqual(['Adopt as rule', 'Reject']);
  });
});
