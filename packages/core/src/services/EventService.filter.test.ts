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
});
