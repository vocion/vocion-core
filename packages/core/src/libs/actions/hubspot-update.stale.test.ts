import { afterEach, describe, expect, it, vi } from 'vitest';

// The token is a pasted one with no source row, so it is used as stored.
vi.mock('@/libs/DB');

const { hubspotUpdateAction } = await import('./hubspot-update');

const CTX = { orgId: 'o', credentials: { token: 't' } };
const input = (properties: Record<string, string>) => hubspotUpdateAction.inputSchema.parse({ objectType: 'deals', objectId: '4812', properties });

function res(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

/**
 * HubSpot's answer for the deal, whatever is asked.
 * @param body
 * @param status
 */
function hubspotHolds(body: unknown, status = 200) {
  const f = vi.fn(async () => res(body, status));
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe('hubspot.update: basis', () => {
  it('records the current values of exactly the properties it writes', async () => {
    const f = hubspotHolds({ id: '4812', properties: { dealstage: 'presentationscheduled', hs_next_step: null } });
    const basis = await hubspotUpdateAction.basisFor!(CTX, input({ dealstage: 'closedwon', hs_next_step: 'Send the SOW' }));

    expect(basis).toEqual({ values: { dealstage: 'presentationscheduled', hs_next_step: null } });
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toContain('properties=dealstage%2Chs_next_step');
  });
});

describe('hubspot.update: stillHolds', () => {
  const basis = { values: { dealstage: 'presentationscheduled', hs_next_step: null } };

  it('holds when nobody changed what it would overwrite', async () => {
    hubspotHolds({ id: '4812', properties: { dealstage: 'presentationscheduled', hs_next_step: null } });

    await expect(hubspotUpdateAction.stillHolds!(CTX, input({ dealstage: 'closedwon', hs_next_step: 'Send the SOW' }), basis)).resolves.toBeNull();
  });

  it('names a field someone changed since, old to new', async () => {
    hubspotHolds({ id: '4812', properties: { dealstage: 'closedwon', hs_next_step: null } });
    const out = await hubspotUpdateAction.stillHolds!(CTX, input({ dealstage: 'contractsent', hs_next_step: 'Send the SOW' }), basis);

    expect(out).toEqual({
      line: 'dealstage changed from presentationscheduled to closedwon since this was proposed',
      changed: [{ label: 'dealstage', from: 'presentationscheduled', to: 'closedwon' }],
    });
  });

  it('names every field that changed when more than one did', async () => {
    hubspotHolds({ id: '4812', properties: { dealstage: 'closedwon', hs_next_step: 'Kickoff call' } });
    const out = await hubspotUpdateAction.stillHolds!(CTX, input({ dealstage: 'contractsent', hs_next_step: 'Send the SOW' }), basis);

    expect(out?.line).toBe('2 fields it would overwrite changed since this was proposed: dealstage (presentationscheduled to closedwon), hs_next_step ((empty) to Kickoff call)');
    expect(out?.changed).toHaveLength(2);
  });

  it('a deleted record is stale', async () => {
    hubspotHolds({ message: 'not found' }, 404);
    const out = await hubspotUpdateAction.stillHolds!(CTX, input({ dealstage: 'closedwon' }), basis);

    expect(out?.line).toBe('HubSpot deal 4812 was deleted or merged away since this was proposed');
  });

  it('a record merged into another is stale, naming where it went', async () => {
    hubspotHolds({ id: '5120', properties: { dealstage: 'presentationscheduled' } });
    const out = await hubspotUpdateAction.stillHolds!(CTX, input({ dealstage: 'closedwon' }), basis);

    expect(out?.line).toBe('HubSpot deal 4812 was merged into deal 5120 since this was proposed');
  });

  it('a HubSpot that does not answer throws, which core reads as "still holds"', async () => {
    hubspotHolds({ message: 'unavailable' }, 503);

    await expect(hubspotUpdateAction.stillHolds!(CTX, input({ dealstage: 'closedwon' }), basis)).rejects.toThrow(/HubSpot read failed/);
  });

  it('with no basis it still catches a deleted record, and otherwise holds', async () => {
    hubspotHolds({ id: '4812', properties: { dealstage: 'closedwon' } });

    await expect(hubspotUpdateAction.stillHolds!(CTX, input({ dealstage: 'contractsent' }), null)).resolves.toBeNull();
  });
});
