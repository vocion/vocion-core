import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { transientModelFailure } = await import('./AutomationService');

describe('transientModelFailure', () => {
  it('is true only when every failed task failed on the provider being busy or the line dropping (review 5839)', () => {
    expect(transientModelFailure({ tasks: [{ status: 'failed', error: 'Error: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }] })).toBe(true);
    expect(transientModelFailure({ tasks: [{ status: 'failed', error: '429 rate_limit_error' }, { status: 'done' }] })).toBe(true);
    expect(transientModelFailure({ tasks: [{ status: 'failed', error: 'automation "x": mission "y" not found' }] })).toBe(false);
    expect(transientModelFailure({ tasks: [{ status: 'failed', error: 'overloaded_error' }, { status: 'failed', error: 'TypeError: x is undefined' }] })).toBe(false);
    expect(transientModelFailure({})).toBe(false);
  });
});
