/**
 * hubspot.create: create a HubSpot CRM record (deal, contact, company),
 * associated to the records it belongs with. The write behind "put this
 * signed SOW in the CRM": `hubspot.update` needs a record that exists, so a
 * new deal had no way in (2026-10-22, a Revenue chat drafted the deal for a
 * person to paste by hand).
 *
 * `external: true` + grant `update_crm` → an agent proposing this is gated into
 * the review queue. Undo archives the created record (HubSpot keeps it
 * restorable for 90 days).
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';
import { createHubspotClient } from '@/libs/hubspot/client';

type ObjectType = 'contacts' | 'deals' | 'companies';

/**
 * HubSpot-defined association type ids, per pair (from → to). Deal → company
 * is the primary-company type, so the deal shows under the company.
 */
const ASSOCIATION_TYPE: Record<ObjectType, Partial<Record<ObjectType, number>>> = {
  deals: { companies: 5, contacts: 3 },
  contacts: { companies: 1, deals: 4 },
  companies: { contacts: 280, deals: 342 },
};

/** The property a record of each type is named by, required on create. */
const NAME_PROPERTY: Record<ObjectType, string> = { deals: 'dealname', companies: 'name', contacts: 'email' };

const numericId = z.string().regex(/^\d+$/, 'toObjectId must be the numeric HubSpot record id (the number after the colon in a mirror ref like companies:4812), not a name');

const hubspotCreateInput = z.object({
  objectType: z.enum(['contacts', 'deals', 'companies']),
  /**
   * Properties to set, by internal name. A deal takes `dealname`, `amount`,
   * `closedate` (YYYY-MM-DD), `dealstage` (the stage ID, never its label),
   * `pipeline` and `description`.
   */
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  /** Records the new one belongs with, e.g. the company a deal is for. */
  associations: z.array(z.object({ toObjectType: z.enum(['contacts', 'deals', 'companies']), toObjectId: numericId })).default([]),
  baseUrl: z.string().url().default('https://api.hubapi.com'),
}).superRefine((input, ctx) => {
  const nameKey = NAME_PROPERTY[input.objectType];
  const name = input.properties[nameKey];
  if (name === undefined || name === null || String(name).trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['properties', nameKey], message: `a new ${input.objectType.replace(/s$/, '')} needs properties.${nameKey}` });
  }
  for (const [i, a] of input.associations.entries()) {
    if (a.toObjectType === input.objectType) {
      ctx.addIssue({ code: 'custom', path: ['associations', i, 'toObjectType'], message: `a ${input.objectType.replace(/s$/, '')} cannot be associated to another ${a.toObjectType.replace(/s$/, '')}` });
    }
  }
});

/**
 * The HubSpot token for this run; see `hubspot-update.ts`.
 * @param ctx - The action context carrying the vault credentials.
 */
async function freshHubspotToken(ctx: ActionContext): Promise<string | undefined> {
  const { hubspotTokenForActionSlug } = await import('@/services/agents/tools/hubspotDirect');
  return hubspotTokenForActionSlug(ctx.orgId, 'hubspot', ctx.credentials);
}

/**
 * Why a deal's stage or pipeline would be refused, naming the ids to use
 * instead. HubSpot takes a stage ID; a label ("Negotiation") 400s after a
 * person has already approved the card, so it is caught at proposal time.
 * @param stages - Every deal stage, keyed by id.
 * @param dealstage - The proposed stage.
 * @param pipeline - The proposed pipeline, when set.
 */
export function stageRefusal(stages: Map<string, { label: string; pipelineId: string; pipelineLabel: string }>, dealstage: string | undefined, pipeline: string | undefined): string | undefined {
  stages = new Map([...stages].map(([id, s]) => [id, { ...s, label: s.label.trim(), pipelineLabel: s.pipelineLabel.trim() }]));
  if (pipeline && ![...stages.values()].some(s => s.pipelineId === pipeline)) {
    const pipelines = [...new Map([...stages.values()].map(s => [s.pipelineId, s.pipelineLabel])).entries()];
    return `"${pipeline}" is not a deal pipeline id. Pipelines: ${pipelines.map(([id, label]) => `${label} = ${id}`).join('; ')}.`;
  }
  if (!dealstage) {
    return undefined;
  }
  const stage = stages.get(dealstage);
  if (stage) {
    return pipeline && stage.pipelineId !== pipeline ? `Stage ${dealstage} (${stage.label}) belongs to the ${stage.pipelineLabel} pipeline (${stage.pipelineId}), not ${pipeline}.` : undefined;
  }
  const wanted = dealstage.trim().toLowerCase();
  const byLabel = [...stages.entries()].filter(([, s]) => s.label.toLowerCase() === wanted && (!pipeline || s.pipelineId === pipeline));
  if (byLabel.length > 0) {
    return `dealstage takes the stage ID, not its label. "${dealstage}" is ${byLabel.map(([id, s]) => `${id} in the ${s.pipelineLabel} pipeline (pipeline ${s.pipelineId})`).join(', or ')}.`;
  }
  const options = [...stages.entries()].filter(([, s]) => !pipeline || s.pipelineId === pipeline).map(([id, s]) => `${s.label} = ${id} (${s.pipelineLabel})`);
  return `"${dealstage}" is not a deal stage. Stages: ${options.join('; ')}.`;
}

function singular(objectType: ObjectType): string {
  return objectType === 'companies' ? 'company' : objectType.replace(/s$/, '');
}

export const hubspotCreateAction: Action<typeof hubspotCreateInput> = {
  id: 'hubspot.create',
  name: 'Create HubSpot record',
  description: 'Create a HubSpot deal, contact, or company, associated to the records it belongs with (a new deal to its company and contacts). For a record that already exists, use hubspot.update.',
  inputSchema: hubspotCreateInput,
  grant: 'update_crm',
  external: true,
  sourceSlug: 'hubspot',
  async precheck(ctx, input) {
    if (input.objectType !== 'deals') {
      return;
    }
    const dealstage = input.properties.dealstage == null ? undefined : String(input.properties.dealstage);
    const pipeline = input.properties.pipeline == null ? undefined : String(input.properties.pipeline);
    if (!dealstage && !pipeline) {
      return;
    }
    // Best-effort: with no live client the stage is checked by HubSpot on execute.
    const { hubspotClientForOrg } = await import('@/services/agents/tools/hubspotDirect');
    const live = await hubspotClientForOrg(ctx.orgId);
    if (!live.ok) {
      return;
    }
    const stages = await live.client.fetchDealStages();
    return stages.ok ? stageRefusal(stages.data, dealstage, pipeline) : undefined;
  },
  async reviewCard(_ctx, input) {
    return {
      title: `Create HubSpot ${singular(input.objectType)}`,
      system: 'HubSpot CRM',
      fields: [
        ...Object.entries(input.properties).map(([label, value]) => ({ label, value: String(value ?? '') })),
        ...input.associations.map(a => ({ label: `Associated ${singular(a.toObjectType)}`, value: `${a.toObjectType}:${a.toObjectId}` })),
      ],
      verbs: { approve: 'Create', reject: 'Reject' },
    };
  },
  async execute(ctx, input) {
    const token = await freshHubspotToken(ctx);
    if (!token) {
      throw new Error('hubspot.create requires connected HubSpot credentials (credentials.token)');
    }
    const client = createHubspotClient({ token, baseUrl: input.baseUrl });
    const associations = input.associations.map(a => ({
      to: { id: a.toObjectId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION_TYPE[input.objectType][a.toObjectType] }],
    }));
    const res = await client.post<{ id?: string; createdAt?: string }>(
      `/crm/v3/objects/${input.objectType}`,
      { properties: input.properties, ...(associations.length > 0 ? { associations } : {}) },
    );
    if (!res.ok) {
      throw new Error(`HubSpot create failed: ${res.message}`);
    }
    if (!res.data.id) {
      throw new Error('HubSpot create returned no record id');
    }
    return {
      objectType: input.objectType,
      objectId: res.data.id,
      ref: `${input.objectType}:${res.data.id}`,
      associated: input.associations.map(a => `${a.toObjectType}:${a.toObjectId}`),
      createdAt: res.data.createdAt ?? null,
    };
  },
  // Undo archives the record it created; HubSpot keeps it restorable for 90 days.
  async undo(ctx, input, result) {
    const token = await freshHubspotToken(ctx);
    if (!token) {
      throw new Error('hubspot.create undo requires connected HubSpot credentials (credentials.token)');
    }
    const objectId = typeof result.objectId === 'string' ? result.objectId : undefined;
    if (!objectId) {
      throw new Error('This create recorded no record id, so there is nothing to archive. Remove it by hand in HubSpot.');
    }
    const client = createHubspotClient({ token, baseUrl: input.baseUrl });
    const res = await client.delete(`/crm/v3/objects/${input.objectType}/${objectId}`);
    if (!res.ok) {
      throw new Error(`HubSpot undo failed: ${res.message}`);
    }
    return { archived: `${input.objectType}:${objectId}` };
  },
};
