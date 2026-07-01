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
  async execute(ctx, input) {
    const token = ctx.credentials?.token as string | undefined;
    if (!token) {
      throw new Error('hubspot.update requires connected HubSpot credentials (credentials.token)');
    }
    const res = await fetch(`${input.baseUrl}/crm/v3/objects/${input.objectType}/${input.objectId}`, {
      method: 'PATCH',
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ properties: input.properties }),
    });
    if (!res.ok) {
      throw new Error(`HubSpot update failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const body = (await res.json()) as { id?: string; updatedAt?: string };
    return {
      objectType: input.objectType,
      objectId: body.id ?? input.objectId,
      updated: Object.keys(input.properties),
      updatedAt: body.updatedAt ?? null,
    };
  },
};
