/**
 * The goal draft on the Decision card: what the person reads and edits, and
 * how their edit is read back — the parts it can read, and nothing guessed.
 * Fixtures are fictional (Northwind Expo).
 */
import { describe, expect, it } from 'vitest';
import { applyGoalDraft, goalCreateAction, goalDraftText, storedMeasure } from './goal-create';

const parse = (i: unknown) => goalCreateAction.inputSchema.parse(i);

const MILESTONES = parse({
  title: 'Build referral partner collateral',
  horizon: '2026-Q4',
  measure: { kind: 'milestones', milestones: [{ label: 'One-pager', link: { kind: 'artifact', id: '31' } }, { label: 'Deck' }, { label: 'Case study' }] },
  weekly_review: true,
});

describe('the goal draft on the card', () => {
  it('reads as plain lines a person can edit', () => {
    expect(goalDraftText(MILESTONES)).toBe([
      'Title: Build referral partner collateral',
      'Horizon: 2026-Q4',
      'Milestones:',
      '1. One-pager',
      '2. Deck',
      '3. Case study',
      'Weekly review: yes',
    ].join('\n'));
  });

  it('reads an edit back: title, horizon, milestones (links kept by label) and the review', () => {
    const edited = applyGoalDraft(MILESTONES, [
      'Title: Build the referral partner kit',
      'Horizon: 2026-11-30',
      'Milestones:',
      '- One-pager',
      '- Partner deck',
      '- Case study with Contoso Supply',
      '- Pricing sheet',
      'Weekly review: no',
    ].join('\n'));

    expect(edited).toMatchObject({ title: 'Build the referral partner kit', horizon: '2026-11-30', weekly_review: false });
    expect(edited.measure).toEqual({ kind: 'milestones', milestones: [{ label: 'One-pager', link: { kind: 'artifact', id: '31' } }, { label: 'Partner deck' }, { label: 'Case study with Contoso Supply' }, { label: 'Pricing sheet' }] });
  });

  it('leaves what it cannot read as the agent drafted it', () => {
    const edited = applyGoalDraft(MILESTONES, 'Title: x\nHorizon: whenever\nMilestones:\n1. only one');

    expect(edited.title).toBe(MILESTONES.title);
    expect(edited.horizon).toBe('2026-Q4');
    expect(edited.measure).toEqual(MILESTONES.measure);
  });

  it('reads a view goal\'s target, and stores milestones keyed m1…', () => {
    const view = parse({ title: 'Follow up with Northwind Expo contacts', horizon: '2026-11-30', measure: { kind: 'view', view: 'northwind-expo-contacts', done: { reply_state: 'replied' }, target: 40, unit: 'contacted' } });

    expect(goalDraftText(view)).toContain('Measure: View “northwind-expo-contacts” · done when reply_state = replied · target 40 contacted');
    expect(applyGoalDraft(view, `${goalDraftText(view)}\nTarget: 35`.replace('Target: 40\n', '')).measure).toMatchObject({ target: 35 });
    expect(storedMeasure(MILESTONES.measure)).toEqual({ kind: 'milestones', milestones: [{ key: 'm1', label: 'One-pager', done: false, link: { kind: 'artifact', id: '31' } }, { key: 'm2', label: 'Deck', done: false }, { key: 'm3', label: 'Case study', done: false }] });
  });
});
