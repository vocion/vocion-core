import { afterEach, describe, expect, it, vi } from 'vitest';
import { hubspotUpdateAction } from './hubspot-update';

function res(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body, text: async () => 'err' } as unknown as Response;
}
function parse(input: Record<string, unknown>) {
  return hubspotUpdateAction.inputSchema.parse(input);
}

afterEach(() => vi.unstubAllGlobals());

describe('hubspotUpdateAction', () => {
  it('PATCHes the object and returns the changed keys', async () => {
    const f = vi.fn(async () => res({ id: '4812', updatedAt: '2026-07-01T00:00:00Z' }));
    vi.stubGlobal('fetch', f);

    const out = await hubspotUpdateAction.execute(
      { orgId: 'o', credentials: { token: 't' } },
      parse({ objectType: 'deals', objectId: '4812', properties: { dealstage: 'presentationscheduled', hs_next_step: 'send SOW' } }),
    );

    expect(out).toMatchObject({ objectType: 'deals', objectId: '4812' });
    expect(out.updated).toEqual(['dealstage', 'hs_next_step']);

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toContain('/crm/v3/objects/deals/4812');
    expect(init.method).toBe('PATCH');
    expect(String(init.body)).toContain('presentationscheduled');
  });

  it('refuses without credentials', async () => {
    await expect(hubspotUpdateAction.execute({ orgId: 'o' }, parse({ objectType: 'contacts', objectId: '9412', properties: { lifecyclestage: 'sql' } })))
      .rejects
      .toThrow(/credentials/);
  });

  it('surfaces a HubSpot API error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({}, false)));

    await expect(hubspotUpdateAction.execute({ orgId: 'o', credentials: { token: 't' } }, parse({ objectType: 'deals', objectId: '4812', properties: { amount: 1000 } })))
      .rejects
      .toThrow(/HubSpot update failed/);
  });
});

describe('the record id is HubSpot\'s number', () => {
  it('refuses a name or slug where the numeric id belongs, and says what to pass', () => {
    // An approved update carrying a deal slug instead of its id reached HubSpot and 404'd (2026-09-17).
    const res = hubspotUpdateAction.inputSchema.safeParse({ objectType: 'deals', objectId: 'northwind-operational-ai', properties: { closedate: '2026-10-17' } });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain('numeric HubSpot record id');
  });
});
