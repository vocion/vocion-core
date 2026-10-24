/**
 * The Routing section's words: whether routing is on, and on whose key.
 */
import { describe, expect, it } from 'vitest';
import { routingStatusLine, share } from './routingStatus';

describe('the routing status line', () => {
  it('says routing is off with no key, and on whose key otherwise, never the key', () => {
    expect(routingStatusLine(null)).toMatch(/off: no Jev \(TypeSafe\) API key/);
    expect(routingStatusLine({ effective: null })).toMatch(/off/);
    expect(routingStatusLine({ effective: 'workspace', hint: '…a1b2' })).toBe('Dynamic routing is on, on the workspace key (…a1b2).');
    expect(routingStatusLine({ effective: 'instance' })).toBe('Dynamic routing is on, on the instance key.');
  });

  it('writes a share', () => {
    expect(share(1, 4)).toBe('25%');
    expect(share(0, 0)).toBe('—');
  });
});

describe('Jev health cells (ADR 0006, health)', () => {
  it('names the commonest failure, and latency as p50 / p95', async () => {
    const { failuresCell, latencyCell } = await import('./routingStatus');

    expect(failuresCell({ failed: 0, byOutcome: {} })).toBe('0');
    expect(failuresCell({ failed: 5, byOutcome: { auth: 4, timeout: 1 } })).toBe('5 · key rejected');
    expect(latencyCell(null, null)).toBe('—');
    expect(latencyCell(96.4, 310)).toBe('96 / 310 ms');
  });
});
