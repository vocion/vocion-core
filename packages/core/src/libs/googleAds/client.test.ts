import { afterEach, describe, expect, it, vi } from 'vitest';
import { adsSearch, adsValidateThenMutate, createdNames, customerDigits, failureMessage, gaqlDate, gaqlString, unitsToMicros } from './client';

const ACCESS = { accessToken: 'ya29.fixture', customerId: '123-456-7890' };

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());

describe('the Google Ads client', () => {
  it('takes a customer id with or without dashes, and refuses anything else', () => {
    expect(customerDigits('123-456-7890')).toBe('1234567890');
    expect(() => customerDigits('12345')).toThrow(/ten digits/);
  });

  it('quotes GAQL values so text from a person can never end the literal', () => {
    expect(gaqlString('o\'brien\\x')).toBe('\'o\\\'brien\\\\x\'');
    expect(() => gaqlDate('2026-10-01\' OR 1=1')).toThrow(/not a date/);
    expect(gaqlDate('2026-10-01')).toBe('\'2026-10-01\'');
  });

  it('bills in cents: units become micros rounded to the cent', () => {
    expect(unitsToMicros(50)).toBe(50_000_000);
    expect(unitsToMicros(6.005)).toBe(6_010_000);
  });

  it('pages a search, sends no developer token (retired 2026-09-09), and names the account in the path', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ok({ results: [{ campaign: { id: '1' } }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(ok({ results: [{ campaign: { id: '2' } }] }));
    const rows = await adsSearch(ACCESS, 'SELECT campaign.id FROM campaign');

    expect(rows).toHaveLength(2);
    expect(String(f.mock.calls[0]![0])).toBe('https://googleads.googleapis.com/v23/customers/1234567890/googleAds:search');
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>)['developer-token']).toBeUndefined();
    expect(JSON.parse(String(f.mock.calls[1]![1]!.body)).pageToken).toBe('p2');
  });

  it('validates a batch before applying it, and reads back what it created', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({ mutateOperationResponses: [{ campaignResult: { resourceName: 'customers/1234567890/campaigns/9' } }] }));
    const res = await adsValidateThenMutate(ACCESS, [{ campaignOperation: {} }]);

    expect(JSON.parse(String(f.mock.calls[0]![1]!.body)).validateOnly).toBe(true);
    expect(JSON.parse(String(f.mock.calls[1]![1]!.body)).validateOnly).toBe(false);
    expect(createdNames(res)).toEqual(['customers/1234567890/campaigns/9']);
  });

  it('a refused validation changes nothing: the apply is never sent', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 400, details: [{ errors: [{ errorCode: { fieldError: 'TOO_LONG' }, message: 'Too long.' }] }] } }), { status: 400 }));

    await expect(adsValidateThenMutate(ACCESS, [{ x: 1 }])).rejects.toThrow('Too long.');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('names the fix when the Cloud project is still on Test access', () => {
    const { message } = failureMessage(403, { error: { details: [{ errors: [{ errorCode: { authorizationError: 'ACTION_NOT_PERMITTED' }, message: 'The Google Cloud project is only approved for use with test accounts. To access non-test accounts, apply for Explorer, Basic or Standard access.' }] }] } });

    expect(message).toMatch(/Explorer access/);
    expect(message).toMatch(/Google Ads API Overview/);
  });
});
