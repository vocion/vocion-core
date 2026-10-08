/**
 * The people family's reads — the connected HR system of record, live, with
 * this workspace's own credential.
 *
 *   people_list  workers, departments, time off or pay runs, filtered.
 *   people_get   one of them whole.
 *
 * Work information only: no government id, birth date, home address,
 * personal contact, bank account or one person's pay ever comes back
 * (`services/people/types.ts`). Present for an agent whose sources include
 * an HR source, narrowed by the person's source ACL. Read-only.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { PeopleRecordKind } from '@/services/people/types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope, familySourceSlugs } from '@/libs/connectors/families';
import { PEOPLE_RECORD_KINDS } from '@/services/people/types';

export const PEOPLE_LIST_TOOL = 'people_list';
export const PEOPLE_GET_TOOL = 'people_get';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export function peopleTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'people')) {
    return [];
  }
  return [listTool(ctx), getTool(ctx)];
}

async function providerFor(ctx: RuntimeContext, source: string | undefined) {
  const { peopleProviderFor } = await import('@/services/people/provider');
  return peopleProviderFor(ctx.orgId, { sourceSlug: source ?? null, allowed: familySourceSlugs(ctx, 'people') });
}

function listTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        for (const [name, value] of [['since', args.since], ['until', args.until]] as const) {
          if (value && !ISO_DATE.test(value)) {
            return JSON.stringify({ ok: false, error: `${name} is an ISO date, e.g. 2026-09-01.` });
          }
        }
        const provider = await providerFor(ctx, args.source);
        const kind = args.kind as PeopleRecordKind;
        if (!provider.kinds.includes(kind)) {
          return JSON.stringify({ ok: false, error: `${provider.vendor} holds no ${kind.replace('_', ' ')} records here. It holds: ${provider.kinds.join(', ')}.` });
        }
        const page = await provider.list(kind, {
          query: args.query?.trim() || undefined,
          status: args.status?.trim() || undefined,
          since: args.since,
          until: args.until,
          limit: Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
          cursor: args.cursor ?? null,
        });
        return JSON.stringify({
          ok: true,
          vendor: provider.vendor,
          source: provider.sourceSlug,
          kind,
          count: page.records.length,
          records: page.records,
          nextCursor: page.nextCursor,
          ...(page.ignored?.length ? { ignored: page.ignored } : {}),
          note: page.records.length === 0
            ? 'Nothing matched.'
            : `Work information only; personal details and individual pay are never returned. ${page.nextCursor ? 'More records exist: pass nextCursor as cursor.' : ''}`.trim(),
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: PEOPLE_LIST_TOOL,
      description: 'List records from the connected HR system (whichever this workspace connected), read live: workers (name, title, department, manager, work email, employment type, work location, start and end dates, status), departments, time off (who, when, what kind, status) or pay runs (period, pay date, status and company-wide totals). Personal details — government ids, birth dates, home addresses, personal contacts, bank details — and any one person\'s pay are never returned. Use it for headcount, who is in a team, who is out, and what payroll cost.',
      schema: z.object({
        kind: z.enum(PEOPLE_RECORD_KINDS).describe('Which records.'),
        query: z.string().max(200).optional().describe('A name or work email to look for.'),
        status: z.string().max(40).optional().describe('The vendor\'s own status word, e.g. active, terminated, approved.'),
        since: z.string().max(40).optional().describe('Time off or pay runs on or after this ISO date.'),
        until: z.string().max(40).optional().describe('Time off or pay runs on or before this ISO date.'),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`How many (default ${DEFAULT_LIMIT}).`),
        cursor: z.string().max(500).optional().describe('nextCursor from the previous page.'),
        source: z.string().optional().describe('The HR source to read, when this agent reaches more than one.'),
      }),
    },
  );
}

function getTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const kind = args.kind as PeopleRecordKind;
        if (!provider.kinds.includes(kind)) {
          return JSON.stringify({ ok: false, error: `${provider.vendor} holds no ${kind.replace('_', ' ')} records here. It holds: ${provider.kinds.join(', ')}.` });
        }
        const record = await provider.get(kind, args.id.trim());
        return JSON.stringify({ ok: true, vendor: provider.vendor, source: provider.sourceSlug, record });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: PEOPLE_GET_TOOL,
      description: 'One record from the connected HR system, read live: a worker, a department, a time-off request or a pay run (with its company-wide totals). Work information only. Take the id from people_list.',
      schema: z.object({
        kind: z.enum(PEOPLE_RECORD_KINDS).describe('What the record is.'),
        id: z.string().min(1).max(200).describe('The record\'s id, from people_list.'),
        source: z.string().optional().describe('The HR source to read, when this agent reaches more than one.'),
      }),
    },
  );
}
