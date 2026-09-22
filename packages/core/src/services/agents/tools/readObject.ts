/**
 * read_object — one record, in full.
 *
 * The read counterpart to `update_object`, and the companion `lookup_objects`
 * always needed. That tool is a DIGEST for scanning many records: it caps
 * every value at 120 characters so twenty of them fit in a turn's context.
 * That is right for "what is on the backlog" and useless the moment an agent
 * has to work with what a field actually says.
 *
 * On 2026-09-22 a lead was asked to move six acceptance criteria out of a
 * request's body and into its `acceptance` field. It found the record, read
 * "Acceptance criteria — each one a person can check: 1. Every screen a user
 * lands on shows the name Stamp — not Send — in …" and stopped, because the
 * rest had been truncated away. It could see the work and not read it.
 *
 * So: one record, every declared field, whole. Scoped exactly like the write
 * — an agent reads in full only the types it was given to work with — and
 * deliberately one at a time, because "all of them, in full" is how a context
 * window is spent without anybody deciding to.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getBusinessObject } from '@/services/BusinessObjectService';

export function readObjectTool(ctx: RuntimeContext) {
  const readable = ctx.objectTypeSlugs;
  return tool(
    async (raw) => {
      const { object_type, id } = raw as { object_type: string; id: number };
      if (!readable.includes(object_type)) {
        return `Refused: this agent does not work with "${object_type}" records. It may read: ${readable.join(', ')}.`;
      }
      const row = await getBusinessObject(id, ctx.orgId);
      if (!row) {
        return `No record #${id} in this workspace. Use lookup_objects to find the id; it is the record's own number, not a name.`;
      }
      const slug = (row as { type?: { slug?: string } }).type?.slug;
      if (slug !== undefined && slug !== object_type) {
        return `Record #${id} is a "${slug}", not a "${object_type}". Read it as its own type.`;
      }
      // The whole record as JSON, which is what a caller that asked for one
      // record in full wants. It is data to work from, never text to paste
      // back — the same rule lookup_objects carries.
      return JSON.stringify({
        id: row.id,
        title: row.title,
        status: row.status,
        ...(row.metadata ?? {}) as Record<string, unknown>,
      });
    },
    {
      name: 'read_object',
      description: 'Read ONE record in full, every field whole. Use it when you need what a field actually says — lookup_objects truncates every value to 120 characters so it can list many, which is the right shape for scanning and the wrong one for working. Find the id with lookup_objects first. Data to work from; never paste it back verbatim.',
      schema: z.object({
        object_type: z.string().min(1).describe(`The object type slug. One of: ${readable.join(', ')}.`),
        id: z.number().int().positive().describe('The record\'s id (from lookup_objects), never its title.'),
      }),
    },
  );
}

/**
 * Present only for an agent that was given object types to work with, exactly
 * like the write.
 * @param ctx - The runtime context.
 */
export function readObjectTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (ctx.objectTypeSlugs.length === 0) {
    return [];
  }
  return [readObjectTool(ctx)];
}
