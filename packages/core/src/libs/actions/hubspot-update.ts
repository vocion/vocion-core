/**
 * hubspot.update — update properties on a HubSpot CRM object (deal, contact,
 * company). The write behind the deals desk (stage / next-step / owner changes)
 * and the hygiene sweep (fill missing fields, fix wrong stages).
 *
 * `external: true` + grant `update_crm` → an agent proposing this is gated into
 * the review queue; a human/token with the grant runs it directly. Creds come
 * from the `hubspot` source's vault entry (private-app token).
 */

import type { Action } from './types';
import { z } from 'zod';
import { createHubspotClient, tokenFromCredentials } from '@/libs/hubspot/client';

const hubspotUpdateInput = z.object({
  objectType: z.enum(['contacts', 'deals', 'companies']),
  /**
   * HubSpot record id — the NUMBER HubSpot assigned, never a name or a slug.
   * An approved update to a deal named by its slug ("northwind-operational-ai")
   * reached HubSpot and came back 404 (2026-09-17): the agent had passed the
   * deal's name as its id, and nothing between the proposal and the API said
   * no. The mirror ref a lookup returns is `deals:<id>`; the number after the
   * colon is what goes here.
   */
  objectId: z.string().regex(/^\d+$/, 'objectId must be the numeric HubSpot record id (the number after the colon in a mirror ref like deals:4812), not a name or slug'),
  /** Properties to set, e.g. `{ dealstage: 'presentationscheduled', hs_next_step: '…' }`. */
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  baseUrl: z.string().url().default('https://api.hubapi.com'),
});

export const hubspotUpdateAction: Action<typeof hubspotUpdateInput> = {
  id: 'hubspot.update',
  name: 'Update HubSpot record',
  description: 'Update properties on a HubSpot deal, contact, or company.',
  inputSchema: hubspotUpdateInput,
  grant: 'update_crm',
  external: true,
  sourceSlug: 'hubspot',
  // The card template, fields only: the properties being set are the review
  // surface. Editing stays on the shell's property editor (input.properties).
  async reviewCard(_ctx, input) {
    return {
      title: `Update HubSpot ${input.objectType === 'companies' ? 'company' : input.objectType.replace(/s$/, '')} record`,
      system: 'HubSpot CRM',
      fields: [
        { label: 'Record', value: `${input.objectType}:${input.objectId}` },
        ...Object.entries(input.properties).map(([label, value]) => ({ label, value: String(value ?? '') })),
      ],
      verbs: { approve: 'Update', reject: 'Reject' },
    };
  },
  async execute(ctx, input) {
    const token = tokenFromCredentials(ctx.credentials as Record<string, unknown> | undefined);
    if (!token) {
      throw new Error('hubspot.update requires connected HubSpot credentials (credentials.token)');
    }
    const client = createHubspotClient({ token, baseUrl: input.baseUrl });
    const keys = Object.keys(input.properties);
    // What the record said BEFORE, so the run can be undone. Best-effort: a
    // read that fails must not block the write a person or the ladder just
    // approved — the run then records that it has nothing to restore.
    let previous: Record<string, string | null> | null = null;
    const before = await client.get<{ properties?: Record<string, string | null> }>(
      `/crm/v3/objects/${input.objectType}/${input.objectId}`,
      { properties: keys.join(',') },
    );
    if (before.ok) {
      previous = Object.fromEntries(keys.map(k => [k, before.data.properties?.[k] ?? null]));
    }
    const res = await client.patch<{ id?: string; updatedAt?: string }>(
      `/crm/v3/objects/${input.objectType}/${input.objectId}`,
      { properties: input.properties },
    );
    if (!res.ok) {
      // Actions run through the review queue, whose contract is throw-on-failure.
      throw new Error(`HubSpot update failed: ${res.message}`);
    }
    const body = res.data;
    return {
      objectType: input.objectType,
      objectId: body.id ?? input.objectId,
      updated: keys,
      updatedAt: body.updatedAt ?? null,
      previous,
    };
  },
  // Reversible: the previous values go back. This is what lets a confident
  // update run on its own (`libs/actions/autoAccept.ts`) — done for you, and
  // one click puts it back.
  async undo(ctx, input, result) {
    const token = tokenFromCredentials(ctx.credentials as Record<string, unknown> | undefined);
    if (!token) {
      throw new Error('hubspot.update undo requires connected HubSpot credentials (credentials.token)');
    }
    const previous = result.previous as Record<string, string | null> | null | undefined;
    if (!previous) {
      throw new Error('This update recorded no previous values, so there is nothing to restore — set the fields by hand in HubSpot.');
    }
    const client = createHubspotClient({ token, baseUrl: input.baseUrl });
    // HubSpot clears a property with an empty string; null is rejected.
    const properties = Object.fromEntries(Object.entries(previous).map(([k, v]) => [k, v ?? '']));
    const res = await client.patch<{ id?: string; updatedAt?: string }>(
      `/crm/v3/objects/${input.objectType}/${input.objectId}`,
      { properties },
    );
    if (!res.ok) {
      throw new Error(`HubSpot undo failed: ${res.message}`);
    }
    return { restored: Object.keys(properties), restoredAt: res.data.updatedAt ?? null };
  },
};
