import { describe, expect, it } from 'vitest';
import { isFreshWorkspace } from './gettingStarted';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-08T12:00:00Z');

describe('a new workspace, for the Getting started row (founder, 2026-10-08)', () => {
  it('is one created in the last two weeks', () => {
    expect(isFreshWorkspace({ createdAt: new Date(now.getTime() - 3 * DAY), hasActivity: true, now })).toBe(true);
  });

  it('is one with no conversation yet, however old', () => {
    expect(isFreshWorkspace({ createdAt: new Date(now.getTime() - 90 * DAY), hasActivity: false, now })).toBe(true);
  });

  it('is never an established one: older than two weeks and in use', () => {
    expect(isFreshWorkspace({ createdAt: new Date(now.getTime() - 15 * DAY), hasActivity: true, now })).toBe(false);
  });
});
