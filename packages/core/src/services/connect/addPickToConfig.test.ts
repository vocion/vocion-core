/**
 * How a pick lands on a source that already exists. A list the person adds to
 * (repositories) keeps what was there; a rule the person restates (the
 * statuses the factory picks up) is replaced, because a union could never
 * clear a status they have taken off the list.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { addPickToConfig } = await import('./createSourceOnLogin');

describe('addPickToConfig', () => {
  it('replaces the statuses the factory picks up, so a later answer clears the earlier one', () => {
    const saved = addPickToConfig('jira', { intakeStatuses: ['To Do'], intakePerDay: 5 }, { intakeStatuses: ['Ready'], intakePerDay: 1 });

    expect(saved.intakeStatuses).toEqual(['Ready']);
    expect(saved.intakePerDay).toBe(1);
  });

  it('still adds to repositories, never removing one', () => {
    const saved = addPickToConfig('github', { repos: ['northwind/portal'] }, { repos: ['northwind/api', 'northwind/portal'] });

    expect(saved.repos).toEqual(['northwind/portal', 'northwind/api']);
  });

  it('still adds to project keys on a Jira source while replacing its intake rule', () => {
    const saved = addPickToConfig('jira', { projectKeys: ['ENG'], intakeStatuses: ['To Do'] }, { projectKeys: ['OPS'], intakeStatuses: ['Ready'] });

    expect(saved.projectKeys).toEqual(['ENG', 'OPS']);
    expect(saved.intakeStatuses).toEqual(['Ready']);
  });

  it('clears the daily limit when the pick says no limit, so "everything now" undoes "one a day"', () => {
    const saved = addPickToConfig('jira', { intakeStatuses: ['Ready'], intakePerDay: 1 }, { intakeStatuses: ['To Do'], intakePerDay: null });

    expect(saved.intakeStatuses).toEqual(['To Do']);
    expect(saved).not.toHaveProperty('intakePerDay');
  });

  it('leaves the fields a pick does not name as they were', () => {
    const saved = addPickToConfig('jira', { intakeStatuses: ['To Do'], baseUrl: 'https://northwind.atlassian.net' }, { projectKeys: ['ENG'] });

    expect(saved.intakeStatuses).toEqual(['To Do']);
  });
});
