/**
 * hubspot.update — update properties on a HubSpot CRM object (deal, contact,
 * company). The write behind the deals desk (stage / next-step / owner changes)
 * and the hygiene sweep (fill missing fields, fix wrong stages).
 *
 * `external: true` + grant `update_crm` → an agent proposing this is gated into
 * the review queue; a human/token with the grant runs it directly. Creds come
 * from the `hubspot` source's vault entry (private-app token).
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';
import { createHubspotClient } from '@/libs/hubspot/client';
import { hubspotRecordUrl } from '@/libs/hubspot/recordUrl';
import { HUBSPOT_FRACTION_FIELDS } from '@/services/inbox/describeActionRun';

/**
 * The HubSpot token for this run: a pasted private-app token as stored, or a
 * login refreshed first (HubSpot's access token lasts 30 minutes) and saved to
 * the `hubspot` source's row. Imported on use: the tool module is heavy.
 * @param ctx - The action context carrying the vault credentials.
 * @throws {Error} When the login cannot be refreshed.
 */
export async function freshHubspotToken(ctx: ActionContext): Promise<string | undefined> {
  const { hubspotTokenForActionSlug } = await hubspotDirect();
  return hubspotTokenForActionSlug(ctx.orgId, 'hubspot', ctx.credentials);
}

/**
 * The portal the workspace's HubSpot source names, when its config says.
 * @param ctx - The run.
 */
export async function configuredHubspotPortal(ctx: ActionContext): Promise<unknown> {
  const { hubspotSourcesForOrg } = await hubspotDirect();
  return (await hubspotSourcesForOrg(ctx.orgId).catch(() => [])).map(s => s.configJson?.portalId).find(p => p !== undefined && p !== null);
}

/** The properties that NAME a record of each type, read so a receipt can say which one changed. */
export const HUBSPOT_NAME_PROPERTIES: Record<string, string[]> = { deals: ['dealname'], contacts: ['firstname', 'lastname', 'email'], companies: ['name', 'domain'] };

/**
 * A record's name from its properties: a deal's name, a person's name or email, a company's name.
 * @param objectType - Its type.
 * @param props - Its properties.
 */
export function hubspotNameOf(objectType: string, props: Record<string, string | null | undefined>): string | null {
  const v = (k: string) => (props[k] ?? '').trim();
  const name = objectType === 'contacts'
    ? ([v('firstname'), v('lastname')].filter(Boolean).join(' ') || v('email'))
    : (HUBSPOT_NAME_PROPERTIES[objectType] ?? []).map(v).find(Boolean) ?? '';
  return name || null;
}

/**
 * The direct HubSpot tools module, loaded on use. The one dynamic import of it
 * for the hubspot actions: a second site made Turbopack emit two chunks to one
 * output path and fail the production build (as in #1266).
 */
export function hubspotDirect(): Promise<typeof import('@/services/agents/tools/hubspotDirect')> {
  return import('@/services/agents/tools/hubspotDirect');
}

/**
 * Plain names for standard HubSpot properties, as a person says them, to the internal name HubSpot
 * takes. None of them is a property on any HubSpot object, so mapping one never redirects a write
 * that would have landed. A teammate's walk (2026-10-30): "probability 90%" was written as
 * `probability`, HubSpot refused the whole update with a 400, and nothing changed.
 */
const PLAIN_PROPERTY_NAMES: Record<string, string> = {
  probability: 'hs_deal_stage_probability',
  deal_probability: 'hs_deal_stage_probability',
  win_probability: 'hs_deal_stage_probability',
  deal_stage_probability: 'hs_deal_stage_probability',
  stage: 'dealstage',
  deal_stage: 'dealstage',
  close_date: 'closedate',
  next_step: 'hs_next_step',
  deal_name: 'dealname',
};

/**
 * The properties by the names HubSpot takes; a name it already takes is left as written.
 * @param props - The properties as proposed.
 */
function asInternalNames<V>(props: Record<string, V>): Record<string, V> {
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [PLAIN_PROPERTY_NAMES[k.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? k, v]));
}

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
  /**
   * Properties to set by their HubSpot internal names, e.g. `{ dealstage: 'presentationscheduled',
   * hs_deal_stage_probability: 0.9, hs_next_step: '…' }`. The plain names people say for a few
   * standard deal properties ("probability", "stage", "close_date", "next_step") are taken as those.
   */
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).transform(asInternalNames),
  baseUrl: z.string().url().default('https://api.hubapi.com'),
});

type HubspotUpdateInput = z.infer<typeof hubspotUpdateInput>;

/**
 * One property value as a person reads it.
 * @param value
 */
/**
 * The properties as HubSpot takes them: a probability HubSpot keeps as a
 * 0–1 fraction, written as a percentage ("90" for "probability 90%"), is
 * sent as 0.9 rather than refused with a 400.
 * @param props - What the update writes.
 */
function asHubspotWrites(props: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(props).map(([k, v]) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
    return HUBSPOT_FRACTION_FIELDS.has(k) && Number.isFinite(n) && n > 1 && n <= 100 ? [k, String(n / 100)] : [k, v];
  }));
}

/**
 * Property values as strings, the way HubSpot reads them back.
 * @param props - What the update writes.
 */
function stringProps(props: Record<string, string | number | boolean | null>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v === null ? null : String(v)]));
}

function shown(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '(empty)' : value;
}

/**
 * HubSpot's singular for the object type.
 * @param objectType
 */
function noun(objectType: HubspotUpdateInput['objectType']): string {
  return objectType === 'companies' ? 'company' : objectType.replace(/s$/, '');
}

/**
 * The record as HubSpot holds it now, for the properties this update writes.
 * `gone` when HubSpot no longer has it; throws when HubSpot cannot be read.
 * @param ctx - The action context carrying the vault credentials.
 * @param input - The update.
 */
async function currentValues(ctx: ActionContext, input: HubspotUpdateInput): Promise<{ gone: true } | { gone: false; id: string; values: Record<string, string | null> }> {
  const token = await freshHubspotToken(ctx);
  if (!token) {
    throw new Error('no HubSpot credentials');
  }
  const client = createHubspotClient({ token, baseUrl: input.baseUrl });
  const keys = Object.keys(input.properties);
  const res = await client.get<{ id?: string; properties?: Record<string, string | null> }>(
    `/crm/v3/objects/${input.objectType}/${input.objectId}`,
    { properties: keys.join(',') },
  );
  if (!res.ok) {
    if (res.error === 'hubspot_error' && res.status === 404) {
      return { gone: true };
    }
    throw new Error(`HubSpot read failed: ${res.message}`);
  }
  return {
    gone: false,
    id: String(res.data.id ?? input.objectId),
    values: Object.fromEntries(keys.map(k => [k, res.data.properties?.[k] ?? null])),
  };
}

export const hubspotUpdateAction: Action<typeof hubspotUpdateInput> = {
  id: 'hubspot.update',
  name: 'Update HubSpot record',
  description: 'Update properties on a HubSpot deal, contact, or company.',
  inputSchema: hubspotUpdateInput,
  // The record it writes, by the mirror's own key.
  subjectRefs: input => [`${input.objectType}:${input.objectId}`],
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
  // What the update assumed: the values of exactly the properties it writes,
  // as they were when it was proposed.
  async basisFor(ctx, input) {
    const now = await currentValues(ctx, input);
    return now.gone ? null : { values: now.values };
  },
  // Stale when someone changed a property it would overwrite, or the record
  // was merged into another or deleted. HubSpot not answering throws: core
  // reads that as "still holds".
  async stillHolds(ctx, input, basis) {
    const now = await currentValues(ctx, input);
    const record = `HubSpot ${noun(input.objectType)} ${input.objectId}`;
    if (now.gone) {
      return { line: `${record} was deleted or merged away since this was proposed` };
    }
    if (now.id !== input.objectId) {
      return { line: `${record} was merged into ${noun(input.objectType)} ${now.id} since this was proposed` };
    }
    const before = (basis?.values ?? null) as Record<string, string | null> | null;
    if (!before) {
      return null;
    }
    const changed = Object.keys(before)
      .filter(k => k in now.values && (before[k] ?? null) !== (now.values[k] ?? null))
      .map(k => ({ label: k, from: shown(before[k]), to: shown(now.values[k]) }));
    if (changed.length === 0) {
      return null;
    }
    const first = changed[0]!;
    const line = changed.length === 1
      ? `${first.label} changed from ${first.from} to ${first.to} since this was proposed`
      : `${changed.length} fields it would overwrite changed since this was proposed: ${changed.map(c => `${c.label} (${c.from} to ${c.to})`).join(', ')}`;
    return { line, changed };
  },
  async execute(ctx, input) {
    const token = await freshHubspotToken(ctx);
    if (!token) {
      throw new Error('hubspot.update requires connected HubSpot credentials (credentials.token)');
    }
    const client = createHubspotClient({ token, baseUrl: input.baseUrl });
    const keys = Object.keys(input.properties);
    const properties = asHubspotWrites(input.properties);
    // What the record said BEFORE, so the run can be undone. Best-effort: a
    // read that fails must not block the write a person or the ladder just
    // approved — the run then records that it has nothing to restore.
    // The same read names the record, so the receipt says which deal changed
    // even when the mirror has not seen it yet.
    let previous: Record<string, string | null> | null = null;
    let name: string | null = null;
    const nameKeys = HUBSPOT_NAME_PROPERTIES[input.objectType] ?? [];
    const before = await client.get<{ properties?: Record<string, string | null> }>(
      `/crm/v3/objects/${input.objectType}/${input.objectId}`,
      { properties: [...new Set([...keys, ...nameKeys])].join(',') },
    );
    if (before.ok) {
      previous = Object.fromEntries(keys.map(k => [k, before.data.properties?.[k] ?? null]));
      name = hubspotNameOf(input.objectType, { ...before.data.properties, ...stringProps(input.properties) });
    }
    const res = await client.patch<{ id?: string; updatedAt?: string }>(
      `/crm/v3/objects/${input.objectType}/${input.objectId}`,
      { properties },
    );
    if (!res.ok) {
      // Actions run through the review queue, whose contract is throw-on-failure.
      throw new Error(`HubSpot update failed: ${res.message}`);
    }
    const body = res.data;
    const objectId = body.id ?? input.objectId;
    const url = await hubspotRecordUrl(client, input.objectType, objectId, await configuredHubspotPortal(ctx));
    return {
      objectType: input.objectType,
      objectId,
      // A HubSpot id, not a workspace record's (`libs/actions/resultLinks.ts`).
      ref: `${input.objectType}:${objectId}`,
      updated: keys,
      updatedAt: body.updatedAt ?? null,
      previous,
      ...(name ? { name } : {}),
      ...(url ? { url } : {}),
    };
  },
  // Reversible: the previous values go back. This is what lets a confident
  // update run on its own (`libs/actions/autoAccept.ts`) — done for you, and
  // one click puts it back.
  async undo(ctx, input, result) {
    const token = await freshHubspotToken(ctx);
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
