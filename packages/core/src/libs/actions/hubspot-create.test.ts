import { afterEach, describe, expect, it, vi } from 'vitest';

// A pasted token and no source row: the lookup finds nothing and the token is used as stored.
vi.mock('@/libs/DB');

const { hubspotCreateAction, stageRefusal } = await import('./hubspot-create');
const { actionInputHints, getAction } = await import('./registry');

function res(body: unknown, ok = true, status = ok ? 201 : 400): Response {
  return { ok, status, json: async () => body, text: async () => 'err' } as unknown as Response;
}
function parse(input: Record<string, unknown>) {
  return hubspotCreateAction.inputSchema.parse(input);
}

afterEach(() => vi.unstubAllGlobals());

const deal = {
  objectType: 'deals',
  properties: { dealname: 'Northwind - Operational AI', amount: 12000, closedate: '2026-10-23', dealstage: '1104412873' },
  associations: [{ toObjectType: 'companies', toObjectId: '30071284512' }],
};

describe('hubspotCreateAction', () => {
  it('POSTs the deal with its company association and returns the new id', async () => {
    const f = vi.fn(async () => res({ id: '51234', createdAt: '2026-10-22T15:00:00Z' }));
    vi.stubGlobal('fetch', f);

    const out = await hubspotCreateAction.execute({ orgId: 'o', credentials: { token: 't' } }, parse(deal));

    expect(out).toMatchObject({ objectType: 'deals', objectId: '51234', ref: 'deals:51234', associated: ['companies:30071284512'] });

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(url).toMatch(/\/crm\/v3\/objects\/deals$/);
    expect(init.method).toBe('POST');
    expect(body.properties.dealname).toContain('Northwind');
    expect(body.associations).toEqual([{ to: { id: '30071284512' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }] }]);
  });

  it('surfaces a HubSpot API error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({}, false)));

    await expect(hubspotCreateAction.execute({ orgId: 'o', credentials: { token: 't' } }, parse(deal))).rejects.toThrow(/HubSpot create failed/);
  });

  it('refuses without credentials', async () => {
    await expect(hubspotCreateAction.execute({ orgId: 'o' }, parse(deal))).rejects.toThrow(/credentials/);
  });

  it('undo archives the record it created', async () => {
    const f = vi.fn(async () => res(undefined, true, 204));
    vi.stubGlobal('fetch', f);

    const out = await hubspotCreateAction.undo!({ orgId: 'o', credentials: { token: 't' } }, parse(deal), { objectId: '51234' });

    expect(out).toEqual({ archived: 'deals:51234' });

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toContain('/crm/v3/objects/deals/51234');
    expect(init.method).toBe('DELETE');
  });
});

describe('the input says what a new record needs', () => {
  it('requires the record\'s name property', () => {
    const r = hubspotCreateAction.inputSchema.safeParse({ objectType: 'deals', properties: { amount: 12000 } });

    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('properties.dealname');
  });

  it('refuses a company name where its numeric id belongs', () => {
    const r = hubspotCreateAction.inputSchema.safeParse({ ...deal, associations: [{ toObjectType: 'companies', toObjectId: 'Northwind Traders' }] });

    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('numeric HubSpot record id');
  });

  it('is registered, and the model is told its fields', () => {
    expect(getAction('hubspot.create')).toBe(hubspotCreateAction);
    expect(actionInputHints(['hubspot.create'])).toContain('objectType*=contacts|deals|companies, properties*={…}');
  });
});

describe('a stage label is caught at proposal time', () => {
  const stages = new Map([
    ['appointmentscheduled', { label: 'Discovery', pipelineId: 'default', pipelineLabel: 'Sales Pipeline' }],
    ['1104412873', { label: 'Negotiation', pipelineId: 'default', pipelineLabel: 'Sales Pipeline' }],
  ]);

  it('lets a real stage id through', () => {
    expect(stageRefusal(stages, '1104412873', undefined)).toBeUndefined();
  });

  it('names the id for a label', () => {
    expect(stageRefusal(stages, 'Negotiation', undefined)).toContain('"Negotiation" is 1104412873');
  });

  it('lists the stages for an unknown value', () => {
    expect(stageRefusal(stages, 'signed', undefined)).toContain('Discovery = appointmentscheduled');
  });

  it('refuses an unknown pipeline', () => {
    expect(stageRefusal(stages, undefined, 'nope')).toContain('Sales Pipeline = default');
  });
});
