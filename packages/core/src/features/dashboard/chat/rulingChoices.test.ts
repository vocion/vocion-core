import { describe, expect, it } from 'vitest';
import { rulingChoices } from './rulingChoices';

describe('a ruling card offers its options, not Approve', () => {
  it('lists the options of an ask.file filing, recommended first, with the ids the ask stores', () => {
    expect(rulingChoices({ actionId: 'ask.file', input: { kind: 'ruling', options: ['Split the task', { label: 'Restore paths', recommended: true }] } })).toEqual([
      { id: 'restore-paths', label: 'Restore paths', recommended: true },
      { id: 'split-the-task', label: 'Split the task', recommended: false },
    ]);
  });

  it('is nothing for any other card, or an ask with no options', () => {
    expect(rulingChoices({ actionId: 'factory.dispatch_task', input: { options: ['a'] } })).toBeNull();
    expect(rulingChoices({ actionId: 'ask.file', input: { kind: 'approval' } })).toBeNull();
  });
});
