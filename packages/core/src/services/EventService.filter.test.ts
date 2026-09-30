import { describe, expect, it } from 'vitest';
import { matchesFilter } from './EventService';

describe('an automation filter', () => {
  it('matches equal fields, and a Prefix key against the field it names', () => {
    const pr = { branch: 'factory/send-t146-request-a-file', conclusion: 'success' };

    expect(matchesFilter(pr, { branchPrefix: 'factory/' })).toBe(true);
    expect(matchesFilter(pr, { branchPrefix: 'feat/' })).toBe(false);
    expect(matchesFilter(pr, { conclusion: 'success', branchPrefix: 'factory/' })).toBe(true);
    expect(matchesFilter(pr, { conclusion: 'failure' })).toBe(false);
    expect(matchesFilter({}, { branchPrefix: 'factory/' })).toBe(false);
    expect(matchesFilter(pr, undefined)).toBe(true);
  });

  it('matches an Any key when the list it names shares an item — comma-joined or an array', () => {
    const updated = { objectType: 'request', fields: 'acceptance,visuals' };

    expect(matchesFilter(updated, { objectType: 'request', fieldsAny: ['acceptance', 'outcome'] })).toBe(true);
    expect(matchesFilter({ ...updated, fields: 'visuals' }, { fieldsAny: ['acceptance', 'outcome'] })).toBe(false);
    expect(matchesFilter({ fields: ['surface', 'kind'] }, { fieldsAny: ['surface'] })).toBe(true);
    // A payload that carries no list matches nothing: the automation said which fields it reads.
    expect(matchesFilter({ objectType: 'request' }, { fieldsAny: ['surface'] })).toBe(false);
    // A scalar filter value on an Any key is compared as equal, as before.
    expect(matchesFilter({ fieldsAny: 'x' }, { fieldsAny: 'x' })).toBe(true);
  });
});
