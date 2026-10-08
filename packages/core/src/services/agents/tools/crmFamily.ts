/**
 * The CRM family's reads — the connected CRM, live (Salesforce, Pipedrive,
 * Attio today; `services/crm/provider.ts`).
 *
 * The knowledge index mirrors one document per record, but only who or what
 * the record is; the stage, the amount, the owner and what was logged last
 * week move faster than a sync. A seat that answers "where does the Northwind
 * deal stand", preps a call from an account's history, or fixes a record
 * reads it here instead, and writes through `propose_action` with
 * `crm.update_record` or `crm.add_note`, so the trust ladder, the ledger and
 * Undo apply.
 *
 * Present for any agent whose `connectorSources` include a CRM source
 * (`familyInScope`); the provider is the source's, never named by the agent.
 * HubSpot keeps its own `hubspot_*` tools.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { CrmObject } from '@/services/crm/provider';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope, familySourceSlugs } from '@/libs/connectors/families';

export const CRM_SEARCH_TOOL = 'crm_search_records';
export const CRM_GET_TOOL = 'crm_get_record';
export const CRM_ACTIVITY_TOOL = 'crm_record_activity';
export const CRM_DEALS_TOOL = 'crm_list_deals';
export const CRM_FIELDS_TOOL = 'crm_list_fields';

const objectArg = z.enum(['account', 'contact', 'deal']).describe('account (a company/organization), contact (a person), or deal (an opportunity).');
const sourceArg = z.string().max(80).optional().describe('The CRM source, when the workspace has more than one.');

export function crmFamilyTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'crm')) {
    return [];
  }
  return [searchTool(ctx), getTool(ctx), activityTool(ctx), dealsTool(ctx), fieldsTool(ctx)];
}

/**
 * The provider for this call: the source named, else the agent's one CRM
 * source, else the workspace's one CRM source.
 * @param ctx - The turn.
 * @param source - The source the model named, if any.
 */
async function providerFor(ctx: RuntimeContext, source: string | undefined) {
  const { crmProviderFor } = await import('@/services/crm/provider');
  const mine = familySourceSlugs(ctx, 'crm');
  if (source && !mine.includes(source)) {
    throw new Error(`${source} is not one of this agent's CRM sources (${mine.join(', ')}).`);
  }
  return crmProviderFor(ctx.orgId, { sourceSlug: source ?? (mine.length === 1 ? mine[0] : null) });
}

function failed(err: unknown): string {
  return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
}

const WRITE_NOTE = 'To change a record, propose_action crm.update_record (field names from crm_list_fields); to log what happened, crm.add_note. Both take the record\'s object and id from here.';

function searchTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const records = await provider.search(args.object as CrmObject, args.query, args.limit ?? 10);
        return JSON.stringify({ ok: true, crm: provider.kind, source: provider.sourceSlug, object: args.object, count: records.length, records, note: records.length === 0 ? `No ${args.object} matched "${args.query}". Try a shorter or different part of the name before saying it is not in the CRM.` : 'Read one whole with crm_get_record.' });
      } catch (err) {
        return failed(err);
      }
    },
    {
      name: CRM_SEARCH_TOOL,
      description: 'Find records in the connected CRM (Salesforce, Pipedrive or Attio), live: accounts by name or website, contacts by name or email, deals by name. Returns each match\'s id, name, link, owner, dates, and its key facts (a contact\'s email, title and account; a deal\'s stage, amount, close date and whether it is open). Use it to answer "is X in the CRM", and to get the id the other crm_ tools and actions take.',
      schema: z.object({
        object: objectArg,
        query: z.string().min(1).max(200).describe('Part of the name, or of the email or website.'),
        limit: z.number().int().min(1).max(25).optional().describe('How many (default 10).'),
        source: sourceArg,
      }),
    },
  );
}

function getTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const record = await provider.getRecord(args.object as CrmObject, args.id);
        return JSON.stringify({ ok: true, crm: provider.kind, source: provider.sourceSlug, record, note: WRITE_NOTE });
      } catch (err) {
        return failed(err);
      }
    },
    {
      name: CRM_GET_TOOL,
      description: 'One CRM record whole, read live: every field the CRM returns, plus what hangs off it — an account\'s contacts and deals, a contact\'s deals, a deal\'s contacts. Use it before answering about one account, person or deal, and before proposing a change to it.',
      schema: z.object({
        object: objectArg,
        id: z.string().min(1).max(64).describe('The record id, from crm_search_records.'),
        source: sourceArg,
      }),
    },
  );
}

function activityTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const activity = await provider.activity(args.object as CrmObject, args.id, args.limit ?? 20);
        return JSON.stringify({ ok: true, crm: provider.kind, source: provider.sourceSlug, count: activity.length, activity, note: activity.length === 0 ? 'Nothing is logged on this record in the CRM. That is the CRM\'s answer, not proof nothing happened: calls may be in a meeting recorder.' : undefined });
      } catch (err) {
        return failed(err);
      }
    },
    {
      name: CRM_ACTIVITY_TOOL,
      description: 'What was logged on one CRM record, newest first, read live: tasks, events, calls, meetings and notes, each with when, who and what it said. Use it for "when did we last talk to them", to prep a call, or to check a follow-up was done.',
      schema: z.object({
        object: objectArg,
        id: z.string().min(1).max(64).describe('The record id, from crm_search_records.'),
        limit: z.number().int().min(1).max(50).optional().describe('How many (default 20).'),
        source: sourceArg,
      }),
    },
  );
}

function dealsTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const deals = await provider.listDeals({ status: args.status ?? 'open', limit: args.limit ?? 50 });
        const unknownOpen = deals.some(d => d.open === null || d.open === undefined);
        return JSON.stringify({
          ok: true,
          crm: provider.kind,
          source: provider.sourceSlug,
          count: deals.length,
          deals,
          note: unknownOpen ? 'This CRM does not say which stages are won or lost, so every deal is listed with its stage; judge open from the stage name and say so.' : 'Least recently updated first: the top of the list is what has gone quiet.',
        });
      } catch (err) {
        return failed(err);
      }
    },
    {
      name: CRM_DEALS_TOOL,
      description: 'The connected CRM\'s deals, read live — open ones only by default, least recently updated first, so the deals that have gone quiet come first. Each with stage, amount, close date, owner and account. Use it for pipeline reviews and "which deals are stalled".',
      schema: z.object({
        status: z.enum(['open', 'all']).optional().describe('open (default) leaves out won and lost deals; all includes them.'),
        limit: z.number().int().min(1).max(200).optional().describe('How many (default 50).'),
        source: sourceArg,
      }),
    },
  );
}

function fieldsTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const fields = await provider.fields(args.object as CrmObject);
        const shown = args.writable_only === false ? fields : fields.filter(f => f.writable);
        return JSON.stringify({ ok: true, crm: provider.kind, source: provider.sourceSlug, object: args.object, count: shown.length, fields: shown.slice(0, 300) });
      } catch (err) {
        return failed(err);
      }
    },
    {
      name: CRM_FIELDS_TOOL,
      description: 'The fields a CRM object carries, by the API name crm.update_record takes, with each field\'s label, type, whether it can be written, and a pick-list\'s allowed values. Call it before proposing an update, so the field name and the value are ones the CRM accepts.',
      schema: z.object({
        object: objectArg,
        writable_only: z.boolean().optional().describe('Only the fields an update can set (default true).'),
        source: sourceArg,
      }),
    },
  );
}
