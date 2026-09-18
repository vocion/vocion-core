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

    // The read of the previous values comes first; the write is the second call.
    const [url, init] = f.mock.calls[1] as unknown as [string, RequestInit];

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

describe('done for you — the update records what it replaced, and undo puts it back', () => {
  it('reads the previous values before writing, and stores them on the result', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PATCH'
      ? res({ id: '4812', updatedAt: '2026-09-18T15:00:00Z' })
      : res({ id: '4812', properties: { dealstage: 'appointmentscheduled', hs_next_step: null } })));
    vi.stubGlobal('fetch', f);

    const out = await hubspotUpdateAction.execute(
      { orgId: 'o', credentials: { token: 't' } },
      parse({ objectType: 'deals', objectId: '4812', properties: { dealstage: 'presentationscheduled', hs_next_step: 'send SOW' } }),
    );

    expect(out.previous).toEqual({ dealstage: 'appointmentscheduled', hs_next_step: null });
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('GET');
    expect((f.mock.calls[1] as unknown as [string, RequestInit])[1].method).toBe('PATCH');
  });

  it('still writes when the read fails — the run then has nothing to restore, and says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PATCH' ? res({ id: '4812' }) : res({}, false))));

    const out = await hubspotUpdateAction.execute({ orgId: 'o', credentials: { token: 't' } }, parse({ objectType: 'deals', objectId: '4812', properties: { amount: 1000 } }));

    expect(out.previous).toBeNull();
    await expect(hubspotUpdateAction.undo!({ orgId: 'o', credentials: { token: 't' } }, parse({ objectType: 'deals', objectId: '4812', properties: { amount: 1000 } }), out))
      .rejects
      .toThrow(/nothing to restore/);
  });

  it('undo PATCHes the previous values back, clearing what was empty before', async () => {
    const f = vi.fn(async () => res({ id: '4812', updatedAt: '2026-09-18T15:05:00Z' }));
    vi.stubGlobal('fetch', f);

    const out = await hubspotUpdateAction.undo!(
      { orgId: 'o', credentials: { token: 't' } },
      parse({ objectType: 'deals', objectId: '4812', properties: { dealstage: 'presentationscheduled', hs_next_step: 'send SOW' } }),
      { previous: { dealstage: 'appointmentscheduled', hs_next_step: null } },
    );

    expect(out).toMatchObject({ restored: ['dealstage', 'hs_next_step'] });

    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];

    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ properties: { dealstage: 'appointmentscheduled', hs_next_step: '' } });
  });
});
