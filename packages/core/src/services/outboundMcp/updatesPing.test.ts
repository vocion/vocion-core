import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { readUpdatesNow, verifyUpdatesPing } from './updatesPing';

const token = 'fct_fixture-token-not-real';
const sign = (timestamp: string, body: string, t = token) => `sha256=${createHmac('sha256', createHash('sha256').update(t).digest('hex')).update(`${timestamp}.${body}`).digest('hex')}`;

describe('verifyUpdatesPing', () => {
  const now = 1_800_000_000_000;
  const body = '{"check":"ticket_updates"}';

  it('accepts a recent ping signed with the hash of the source\'s token', () => {
    const timestamp = String(now - 1000);

    expect(verifyUpdatesPing({ token, timestamp, signature: sign(timestamp, body), body, now })).toEqual({ ok: true });
  });

  it('refuses an unsigned, stale, re-bodied or wrongly keyed ping', () => {
    const timestamp = String(now);
    const old = String(now - 6 * 60 * 1000);

    expect(verifyUpdatesPing({ token, timestamp: null, signature: null, body, now })).toEqual({ ok: false, reason: 'unsigned' });
    expect(verifyUpdatesPing({ token, timestamp: old, signature: sign(old, body), body, now })).toEqual({ ok: false, reason: 'stale' });
    expect(verifyUpdatesPing({ token, timestamp, signature: sign(timestamp, body), body: '{"check":"other"}', now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyUpdatesPing({ token, timestamp, signature: sign(timestamp, body, 'fct_another-fixture'), body, now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyUpdatesPing({ token, timestamp: 'soon', signature: 'sha256=00', body, now })).toEqual({ ok: false, reason: 'stale' });
  });
});

describe('readUpdatesNow', () => {
  it('never overlaps two reads of one source: pings during a read become one more read after it', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => gate);

    expect(await readUpdatesNow('org_1', 'factory', run)).toBe('started');
    expect(await readUpdatesNow('org_1', 'factory', run)).toBe('queued');
    expect(await readUpdatesNow('org_1', 'factory', run)).toBe('queued');
    expect(await readUpdatesNow('org_1', 'other', async () => undefined)).toBe('started');

    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });
});
