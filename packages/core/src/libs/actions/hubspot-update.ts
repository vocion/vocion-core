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
  /** HubSpot record id. */
  objectId: z.string().min(1),
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
      title: `Update HubSpot ${input.objectType.replace(/s$/, '')} record`,
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
      updated: Object.keys(input.properties),
      updatedAt: body.updatedAt ?? null,
    };
  },
};
