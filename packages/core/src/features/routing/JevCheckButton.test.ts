import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Orpc', () => ({ client: {} }));

const { checkLine } = await import('./JevCheckButton');

describe('checkLine', () => {
  it('says how the live check went, in one line', () => {
    expect(checkLine({ ok: true, outcome: 'used', reason: null, latencyMs: 112.3, model: 'jev-1.13.0' })).toBe('Jev answered in 112 ms (jev-1.13.0).');
    expect(checkLine({ ok: false, outcome: 'auth', reason: 'Jev (typesafe) answered HTTP 401', latencyMs: 40, model: null })).toBe('Jev rejected the key. Replace it in System Keys.');
    expect(checkLine({ ok: false, outcome: 'timeout', reason: 'no answer within 3000 ms', latencyMs: 3000, model: null })).toBe('No answer: timed out (no answer within 3000 ms).');
    expect(checkLine({ ok: false, outcome: 'no_key', reason: 'no Jev key is set', latencyMs: null, model: null })).toBe('No answer: no key (no Jev key is set).');
  });
});
