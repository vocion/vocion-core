import { describe, expect, it } from 'vitest';
import { sameHost, vendorJson, vendorMessage, VendorRequestError } from './vendorHttp';

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers });
}

describe('vendorJson', () => {
  it('returns the parsed body', async () => {
    await expect(vendorJson({ vendor: 'Ramp', what: 'transactions', url: 'https://api.ramp.example/x', fetch: async () => respond(200, { data: [1] }) })).resolves.toEqual({ data: [1] });
  });

  it('waits out one 429 as the vendor asks, then tries again', async () => {
    const waits: number[] = [];
    let calls = 0;
    const out = await vendorJson({
      vendor: 'Ramp',
      what: 'transactions',
      url: 'https://api.ramp.example/x',
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetch: async () => (calls++ === 0 ? respond(429, {}, { 'retry-after': '2' }) : respond(200, { ok: true })),
    });

    expect(out).toEqual({ ok: true });
    expect(waits).toEqual([2000]);
  });

  it('ends on a second 429 with a sentence, fatal so a sync stops', async () => {
    const error = await vendorJson({ vendor: 'Ramp', what: 'transactions', url: 'https://api.ramp.example/x', sleep: async () => {}, fetch: async () => respond(429, { message: 'Too many requests' }) }).catch(e => e);

    expect(error).toBeInstanceOf(VendorRequestError);
    expect(error).toMatchObject({ status: 429, fatal: true, message: 'Ramp is rate-limiting this account (429). Try again in a minute. Ramp said: Too many requests' });
  });

  it('words each failure for its fix and marks only the account-wide ones fatal', async () => {
    const at = (status: number) => vendorJson({ vendor: 'Xero', what: 'bills', url: 'https://api.xero.example/x', fetch: async () => respond(status, { Message: 'nope' }) }).catch(e => e as VendorRequestError);

    expect(await at(401)).toMatchObject({ fatal: true, message: expect.stringMatching(/^Xero refused the credential \(401\)\. An admin needs to replace it/) });
    expect(await at(403)).toMatchObject({ fatal: false, message: 'Xero would not let this credential read bills (403): it was not granted that access. Xero said: nope' });
    expect(await at(503)).toMatchObject({ fatal: false, message: expect.stringMatching(/failed on its side/) });
  });

  it('says a host could not be reached without quoting the request', async () => {
    const error = await vendorJson({ vendor: 'BILL', what: 'bills', url: 'https://gateway.bill.example/x?sessionId=secret', fetch: async () => {
      throw new TypeError('fetch failed');
    } }).catch(e => e as Error);

    expect((error as Error).message).toBe('BILL could not be reached. Try again later.');
  });
});

describe('vendorMessage and sameHost', () => {
  it('reads the common error shapes', () => {
    expect(vendorMessage({ error: { message: 'a' } })).toBe('a');
    expect(vendorMessage({ errors: [{ detail: 'b' }] })).toBe('b');
    expect(vendorMessage({ error_description: 'c' })).toBe('c');
    expect(vendorMessage('text')).toBeNull();
  });

  it('follows a next-page link only on the credential\'s own https host', () => {
    expect(sameHost('https://api.ramp.example/developer/v1/transactions?start=x', 'https://api.ramp.example')).toBe(true);
    expect(sameHost('https://elsewhere.example/steal', 'https://api.ramp.example')).toBe(false);
    expect(sameHost('http://api.ramp.example/x', 'https://api.ramp.example')).toBe(false);
  });
});
