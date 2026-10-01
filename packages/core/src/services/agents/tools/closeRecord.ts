/**
 * close_record — a record is closed, or retired, for a reason its type names.
 *
 * Conversations 417–422 (2026-10-01): "retire REPO-312 … Do it now, don't ask
 * me", "Close FE-318 as already fixed", "Defer FE-318: it duplicates FE-314".
 * The agent had no path for any of them: `update_object` writes declared
 * fields and refuses the row's status, and the one closing state it reached
 * for, `shipped`, is gated on QA's evidence for a change the factory made.
 *
 * This is the closing path, through `objects.close`: the reasons are the
 * type's own (`x-close` in its schema), so core names none. In a person's
 * turn, when a model reading of their words says they told the agent to
 * close it (`runProposal` → `saidToDecide`), it runs as their action with
 * Undo and puts no card in front of them; an agent closing a record on its
 * own rides the trust ladder for `objects.close.<type>`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { recordIdArg } from './recordIdArg';

/**
 * The record a tool argument names, with its type: a code (FE-294) or an id.
 * @param orgId - The workspace.
 * @param raw - The argument.
 */
async function recordOf(orgId: string, raw: number | string): Promise<{ id: number; typeSlug: string } | { reason: string }> {
  const { resolveCode } = await import('@/services/codes');
  const text = typeof raw === 'number' ? String(raw) : raw.trim().replace(/^#/, '');
  const resolved = await resolveCode(orgId, text);
  if (resolved.kind === 'record') {
    return { id: resolved.id, typeSlug: resolved.typeSlug };
  }
  return { reason: resolved.kind === 'none' ? resolved.reason : `${resolved.code} is not a record` };
}

export function closeRecordTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as { id: number | string; close_as: string; note: string; ref?: number | string; confidence?: number };
      const record = await recordOf(ctx.orgId, args.id);
      if ('reason' in record) {
        return `Not closed: ${record.reason}.`;
      }
      const ref = args.ref === undefined || args.ref === null || args.ref === '' ? undefined : await recordOf(ctx.orgId, args.ref);
      if (ref && 'reason' in ref) {
        return `Not closed: the record it names — ${ref.reason}.`;
      }
      const { runProposal } = await import('./proposeAction');
      return runProposal(ctx, {
        actionId: 'objects.close',
        input: { objectType: record.typeSlug, id: record.id, closeAs: args.close_as, note: args.note, ...(ref ? { ref: ref.id } : {}) },
        confidence: typeof args.confidence === 'number' && args.confidence >= 0 && args.confidence <= 1 ? args.confidence : 0.8,
        rationale: args.note,
        suggestedDecision: 'approve',
        suggestedDecisionReason: args.note,
      }, {
        tool: 'close_record',
        refused: (code, message) => `Not closed (${code}): ${message}`,
      });
    },
    {
      name: 'close_record',
      description: 'Close a record, or retire it, for one of the reasons its type declares — e.g. already fixed elsewhere, a duplicate of another record, deferred, out of scope, answered, retired. Use it when the person says to close, drop, retire, defer or mark a record as a duplicate, and never set a state like "shipped" for work that was not shipped. A record still waiting as a candidate has its card rejected instead. In the person\'s own turn, on their word, it runs as theirs with Undo; a wrong reason is refused with the reasons the type allows.',
      schema: z.object({
        id: recordIdArg('The record to close'),
        close_as: z.string().min(1).max(80).describe('The reason, one the record\'s type declares (a refusal lists them)'),
        note: z.string().min(1).max(1_000).describe('Why, in the person\'s words when they gave them — written on the record'),
        ref: z.union([z.number().int().positive(), z.string().min(1)]).optional().describe('The other record, for a reason that names one (the record this duplicates): its code or id'),
        confidence: z.number().min(0).max(1).optional().describe('Your confidence the person wants this closed for this reason, 0–1'),
      }),
    },
  );
}

/**
 * The closing tool, beside the record write: present wherever an agent can
 * read records.
 * @param ctx - The turn.
 */
export function closeRecordTools(ctx: RuntimeContext): StructuredToolInterface[] {
  return [closeRecordTool(ctx)];
}
