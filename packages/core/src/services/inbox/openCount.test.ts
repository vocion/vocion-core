/**
 * The open tab's count says the badge's number and the failed runs apart, so
 * the header, the badge and a chat answer agree (2026-10-23: 35 beside 24).
 */
import { describe, expect, it } from 'vitest';
import { openCountLine } from './openCount';

describe('the open count in words', () => {
  it('says decisions and failed runs apart, and each alone when it is alone', () => {
    expect(openCountLine(35, 11)).toBe('24 decisions and 11 failed runs to retry or dismiss');
    expect(openCountLine(24, 0)).toBe('24 decisions');
    expect(openCountLine(1, 1)).toBe('1 failed run to retry or dismiss');
    expect(openCountLine(2, 1)).toBe('1 decision and 1 failed run to retry or dismiss');
  });
});
