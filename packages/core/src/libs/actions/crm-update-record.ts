/**
 * `crm.update_record` — set fields on a record in the connected CRM
 * (Salesforce, Pipedrive, Attio): a deal's stage and next step, a contact's
 * title, an account's owner. The family's counterpart of `hubspot.update`.
 *
 * External, so an agent's proposal meets the trust ladder; a person's own
 * word runs as their action. Reversible: the run records what each field
 * held before and Undo writes it back, which is what lets a confident update
 * run on its own once a workspace's ladder says so. Which CRM answers is the
 * source's (`services/crm/provider.ts`), never named here.
 */

import type { Action, ReviewCard } from './types';
import type { CrmFieldValue } from '@/services/crm/provider';
import { z } from 'zod';

export const CRM_UPDATE_ACTION_ID = 'crm.update_record';

const updateInput = z.object({
  object: z.enum(['account', 'contact', 'deal']).describe('account, contact or deal.'),
  id: z.string().min(1).max(64).describe('The record id, from crm_search_records or crm_get_record — never a name.'),
  fields: z.record(z.string().min(1).max(100), z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]))
    .refine(f => Object.keys(f).length > 0 && Object.keys(f).length <= 25, 'Name between 1 and 25 fields.')
    .describe('Field API names (from crm_list_fields) to the value each should hold; null clears a field.'),
  source: z.string().max(80).optional().describe('The CRM source, when the workspace has more than one.'),
  record_name: z.string().max(200).optional().describe('The record\'s name, for the card.'),
});

type Input = z.infer<typeof updateInput>;

export const crmUpdateRecordAction: Action<typeof updateInput> = {
  id: CRM_UPDATE_ACTION_ID,
  name: 'Update a CRM record',
  description: 'Set fields on an account, contact or deal in the connected CRM (Salesforce, Pipedrive or Attio). Field names come from crm_list_fields. Undo puts back what each field held before.',
  inputSchema: updateInput,
  grant: 'update_crm',
  external: true,
  dedupKeyFor: input => `${CRM_UPDATE_ACTION_ID}:${input.source ?? ''}:${input.object}:${input.id}`,
  async reviewCard(_ctx, raw): Promise<ReviewCard> {
    const input = raw as Input;
    const subject = input.record_name ?? `${input.object} ${input.id}`;
    return {
      title: `Update ${subject} in the CRM`,
      system: 'CRM',
      headline: `Approving sets ${Object.keys(input.fields).length} field${Object.keys(input.fields).length === 1 ? '' : 's'} on ${subject} now. Undo puts the old values back.`,
      badges: [{ label: 'CRM' }, { label: 'Undo restores the old values' }],
      fields: [
        { label: 'Record', value: `${input.object} ${input.id}${input.source ? ` (${input.source})` : ''}` },
        ...Object.entries(input.fields).map(([label, value]) => ({ label, value: value === null ? '(cleared)' : String(value) })),
      ],
      nextAction: 'Approving writes these values to the CRM now.',
      verbs: { approve: 'Update', reject: 'Decline' },
    };
  },
  async execute(ctx, input) {
    const { crmProviderFor } = await import('@/services/crm/provider');
    const provider = await crmProviderFor(ctx.orgId, { sourceSlug: input.source ?? null });
    const { previous, url } = await provider.updateRecord(input.object, input.id, input.fields as Record<string, CrmFieldValue>);
    return {
      updated: Object.keys(input.fields),
      crm: provider.kind,
      source: provider.sourceSlug,
      object: input.object,
      id: input.id,
      url,
      previous,
      line: `Updated ${Object.keys(input.fields).join(', ')} on ${input.record_name ?? `${input.object} ${input.id}`} in ${provider.kind}.`,
    };
  },
  async undo(ctx, input, result) {
    const previous = result.previous as Record<string, CrmFieldValue> | null | undefined;
    if (!previous || Object.keys(previous).length === 0) {
      throw new Error('This update recorded no previous values, so there is nothing to restore. Set the fields by hand in the CRM.');
    }
    const source = typeof result.source === 'string' ? result.source : input.source ?? null;
    const { crmProviderFor } = await import('@/services/crm/provider');
    const provider = await crmProviderFor(ctx.orgId, { sourceSlug: source });
    await provider.updateRecord(input.object, input.id, previous);
    return { restored: Object.keys(previous), line: `Put back ${Object.keys(previous).join(', ')} on ${input.record_name ?? `${input.object} ${input.id}`}.` };
  },
};
