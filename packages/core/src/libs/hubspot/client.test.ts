/**
 * Shared HubSpot client — the error-shaping contract every consumer relies on:
 * errors are data, a 403 names the missing scope, and pagination/stage
 * helpers parse HubSpot's shapes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHubspotClient, hubspotNumeric, tokenFromCredentials } from './client';

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('createHubspotClient', () => {
  it('returns data on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { results: [{ id: '1' }] })));
    const out = await createHubspotClient({ token: 't' }).get<{ results: unknown[] }>('/crm/v3/objects/contacts');

    expect(out.ok).toBe(true);
    expect(out.ok && out.data.results).toHaveLength(1);
  });

  it('maps a 403 to missing_scope, naming the scope from the body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(403, {
      status: 'error',
      category: 'MISSING_SCOPES',
      message: 'This app hasn\'t been granted all required scopes',
      errors: [{ context: { requiredGranularScopes: ['sales-email-read'] } }],
    })));
    const out = await createHubspotClient({ token: 't' }).get('/crm/v3/objects/emails/1');

    expect(out).toMatchObject({ ok: false, error: 'missing_scope', scope: 'sales-email-read' });
    expect(!out.ok && out.message).toContain('sales-email-read');
  });

  it('maps any other failure to hubspot_error with the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, { message: 'rate limited' })));
    const out = await createHubspotClient({ token: 't' }).post('/crm/v3/objects/contacts/search', {});

    expect(out).toMatchObject({ ok: false, error: 'hubspot_error', status: 429 });
  });

  it('maps a transport failure to hubspot_error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNRESET');
    }));
    const out = await createHubspotClient({ token: 't' }).get('/crm/v3/owners');

    expect(out).toMatchObject({ ok: false, error: 'hubspot_error' });
    expect(!out.ok && out.message).toContain('ECONNRESET');
  });

  it('fetchDealStages maps every pipeline stage with closed-ness', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, {
      results: [
        { id: 'p1', label: 'Sales Pipeline', stages: [
          { id: 's1', label: 'Discovery', metadata: { isClosed: 'false' } },
          { id: 's2', label: 'Closed lost', metadata: { isClosed: 'true' } },
        ] },
        { id: 'p2', label: 'Renewals', stages: [{ id: 's3', label: 'Won', metadata: { isClosed: true } }] },
      ],
    })));
    const out = await createHubspotClient({ token: 't' }).fetchDealStages();

    expect(out.ok).toBe(true);

    const stages = out.ok ? out.data : new Map();

    expect(stages.get('s1')).toMatchObject({ label: 'Discovery', isClosed: false, pipelineLabel: 'Sales Pipeline' });
    expect(stages.get('s2')!.isClosed).toBe(true);
    expect(stages.get('s3')).toMatchObject({ isClosed: true, pipelineLabel: 'Renewals', pipelineId: 'p2' });
  });
});

describe('tokenFromCredentials', () => {
  it('accepts token or accessToken, rejects blanks', () => {
    expect(tokenFromCredentials({ token: 'a' })).toBe('a');
    expect(tokenFromCredentials({ accessToken: 'b' })).toBe('b');
    expect(tokenFromCredentials({ token: '' })).toBeUndefined();
    expect(tokenFromCredentials(undefined)).toBeUndefined();
  });
});

describe('hubspotNumeric', () => {
  it('parses numbers and drops junk', () => {
    expect(hubspotNumeric('5000.5')).toBe(5000.5);
    expect(hubspotNumeric('')).toBeUndefined();
    expect(hubspotNumeric('n/a')).toBeUndefined();
  });
});
