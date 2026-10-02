/**
 * The two settings setup saves on a Jira source so the factory knows how work
 * enters it: which statuses it picks up and how many a day. Bounds matter: a
 * zero would silence the intake without saying so, and an unbounded list or
 * count would let one answer file a whole backlog at once.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { jiraConfigSchema } = await import('./jira');

const BASE = { baseUrl: 'https://northwind.atlassian.net', projectKeys: ['ENG'] };

describe('jiraConfigSchema intake rules', () => {
  it('accepts a status the factory picks up and rejects an empty one', () => {
    expect(jiraConfigSchema.safeParse({ ...BASE, intakeStatuses: ['To Do'] }).success).toBe(true);
    expect(jiraConfigSchema.safeParse({ ...BASE, intakeStatuses: [''] }).success).toBe(false);
  });

  it('caps the status list at ten', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `Status ${i}`);

    expect(jiraConfigSchema.safeParse({ ...BASE, intakeStatuses: eleven }).success).toBe(false);
  });

  it('accepts 1 to 20 a day and rejects 0 and 21', () => {
    expect(jiraConfigSchema.safeParse({ ...BASE, intakePerDay: 1 }).success).toBe(true);
    expect(jiraConfigSchema.safeParse({ ...BASE, intakePerDay: 20 }).success).toBe(true);
    expect(jiraConfigSchema.safeParse({ ...BASE, intakePerDay: 0 }).success).toBe(false);
    expect(jiraConfigSchema.safeParse({ ...BASE, intakePerDay: 21 }).success).toBe(false);
  });

  it('leaves both unset by default, which is today\'s behaviour', () => {
    const parsed = jiraConfigSchema.parse(BASE);

    expect(parsed.intakeStatuses).toBeUndefined();
    expect(parsed.intakePerDay).toBeUndefined();
  });
});

describe('the Jira form declares them as replace-on-pick', () => {
  it('replaces rather than unions both intake fields', async () => {
    const { configFieldsFor } = await import('./configFields');
    const byKey = Object.fromEntries(configFieldsFor('jira').map(f => [f.key, f]));

    expect(byKey.intakeStatuses?.onPick).toBe('replace');
    expect(byKey.intakePerDay?.onPick).toBe('replace');
    expect(byKey.intakeStatuses?.label).toBe('Statuses the factory picks up');
    expect(byKey.intakePerDay?.label).toBe('How many a day the factory picks up');
  });
});
