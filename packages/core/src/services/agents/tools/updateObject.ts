/**
 * update_object — an agent writes declared fields on a record it can read.
 *
 * The write counterpart to `lookup_objects`. Present only for an agent with
 * at least one object type under `objectTypes:` in its YAML, and refuses a
 * type outside that list before anything is proposed: what an agent may
 * write is what it was given to work with, never what the workspace happens
 * to define.
 *
 * The write itself is the `objects.update_meta` action
 * (`libs/actions/objects-update-meta.ts`): only fields the type's schema
 * declares, each value checked against its field, never the title or the
 * lifecycle status. Through the rail it is done for you above the confidence
 * bar — the fields are written at once and a person can put them back with
 * Undo — and below it, or where the workspace holds the kind at approval, a
 * person decides on a card showing before → after.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ActionError } from '@/services/ActionService';
import { notWritableMessage, pageRecordIds, recordWritable, writeRecordAsAgent } from './recordWrite';

/**
 * A value the model sent as JSON text, read as the object it describes;
 * anything else passes through for the schema to judge.
 * @param v - The raw `set`.
 */
export function parseJsonObject(v: unknown): unknown {
  if (typeof v !== 'string') {
    return v;
  }
  try {
    const parsed = JSON.parse(v) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : v;
  } catch {
    return v;
  }
}

export function updateObjectTool(ctx: RuntimeContext) {
  const writable = ctx.objectTypeSlugs;
  return tool(
    async (raw) => {
      const args = raw as { object_type: string; id: number; set: unknown; reason?: string; confidence?: unknown };
      const { object_type, id } = args;
      // The shape the model sends, accepted here rather than in the schema:
      // `set` as JSON text is the object it describes; no reason says so on
      // the run; no (or a non-numeric) confidence is the middle of the scale,
      // so the trust ladder decides whether a person reviews it.
      const parsedSet = parseJsonObject(args.set);
      if (!parsedSet || typeof parsedSet !== 'object' || Array.isArray(parsedSet)) {
        return 'Update refused: `set` must be an object of field: value — e.g. { "priority": 82 }.';
      }
      const set = parsedSet as Record<string, unknown>;
      const reason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : 'No reason given by the agent.';
      const c = typeof args.confidence === 'number' ? args.confidence : Number(args.confidence);
      const confidence = Number.isFinite(c) && c >= 0 && c <= 1 ? c : 0.5;
      if (!recordWritable(ctx, object_type, id)) {
        return notWritableMessage(ctx, object_type, id);
      }
      try {
        const writtenAt = new Date(Date.now() - 1_000);
        // On the person's word (the turn's intent read) the change is theirs and runs, with undo.
        const intent = ctx.userId && !ctx.missionRunId ? await (ctx.turnIntent ?? Promise.resolve(null)).catch(() => null) : null;
        const onPersonsWord = Boolean(intent && (intent.changes_page_record || intent.changes_existing_record || intent.decides));
        const res = await writeRecordAsAgent(ctx, { objectType: object_type, id, set, reason, confidence, onPersonsWord });
        ctx.emit({ type: 'tool_progress', tool: 'update_object', meta: { runId: res.runId, status: res.status, outcome: res.outcome } } as never);
        const fields = Object.keys(set).join(', ');
        if (res.outcome === 'already_decided') {
          return `Not written: a person already decided this exact change to ${object_type} #${id} (run #${res.runId}, ${res.status}). Do not propose it again.`;
        }
        if (res.outcome === 'refreshed') {
          return `The pending update to ${object_type} #${id} (${fields}) now carries these values (run #${res.runId}); it is still waiting for a person. Do NOT say the record changed.`;
        }
        if (res.status === 'pending') {
          return `Update to ${object_type} #${id} (${fields}) is PENDING a person's decision (run #${res.runId}, held by this workspace's trust rule for this kind of change). Do NOT say the record changed — say in one line it is waiting, with its link: [Review the change](/dashboard/inbox/proposal-${res.runId}).`;
        }
        if (res.status !== 'done') {
          return `Update to ${object_type} #${id} did not land (run #${res.runId} is ${res.status}${res.error ? `: ${res.error}` : ''}).`;
        }
        const r = (res.result ?? {}) as { title?: string; previous?: Record<string, unknown> };
        // A request's contract changed: say what the factory started from it,
        // so the answer does not offer to do what already happened.
        const { contractChangeHeard, contractChangeReceipt } = await import('@/services/factory/carry');
        const started = await contractChangeHeard(ctx.orgId, object_type, Object.keys(set)).catch(() => false)
          ? await contractChangeReceipt(ctx.orgId, id, writtenAt).catch(() => null)
          : null;
        return `${object_type} #${id}${r.title ? ` "${r.title}"` : ''} updated — ${fields} written (run #${res.runId}, confidence ${confidence})${res.version ? `, now version ${res.version.to} of its history` : ''}. Done for you; the previous values are on the run and a person can undo it from Review › Decided.${started ? `\n\n${started}` : ''}`;
      } catch (err) {
        if (err instanceof ActionError) {
          return `Update refused (${err.code}): ${err.message}`;
        }
        return `Update failed: ${(err as Error).message}`;
      }
    },
    {
      name: 'update_object',
      description: `Write one or more fields on an EXISTING record — the record on the person's page (always), or one of a type you work with${writable.length ? ` (${writable.join(', ')})` : ''} — a priority and its reason, a state, the task that answered a request. Only fields the type declares, checked against its schema; never the title, the lifecycle status or the id (those have their own paths). Look the record up first (lookup_objects) and pass its id, not its name. Set a field to null to clear it. Done for you above the confidence bar — the fields are written at once and a person can undo them; below it a person decides on a card showing before → after. Give the reason a person could check against the record.`,
      schema: z.object({
        object_type: z.string().min(1).describe(`The object type slug${writable.length ? ` — ${writable.join(', ')}, or the type of the record on the page` : ' of the record on the page'}.`),
        id: z.number().int().positive().describe('The record\'s id (from the page or lookup_objects), never its title.'),
        // THE SHAPE THE MODEL SENDS, accepted. On 2026-09-25 (backlog 006) the
        // first call of every write passed `set` as a JSON string and left
        // out `reason` and `confidence`; the schema threw, the turn spent its
        // one malformed-call retry on it, and a second mistake ended the turn
        // with nothing written. A string that parses to an object IS the
        // object. A missing reason says so on the run; a missing confidence
        // is the middle of the scale, so the trust ladder — not a default the
        // model never gave — decides whether a person reviews it.
        // PLAIN TYPES ONLY. A tool schema is sent to the model as JSON Schema,
        // and a zod transform (`preprocess`, `coerce`, `default`) cannot be —
        // #731 used one and every turn of every agent with object types failed
        // to bind its tools (2026-09-25 18:35Z, "Transforms cannot be
        // represented in JSON Schema"). The lenience lives in the handler.
        set: z.union([z.record(z.string().min(1), z.unknown()), z.string()]).describe('Fields to write, by name, as an object — e.g. { "priority": 82, "priorityReason": "…", "rankedAt": "2026-09-20T10:00:00Z" }. null clears a field.'),
        reason: z.string().max(500).optional().describe('Why, in one or two sentences a person can check against the record. Written on the run beside the previous values.'),
        confidence: z.union([z.number(), z.string()]).optional().describe('Your confidence these values are right, 0–1. An honest number decides whether they are written now or reviewed first.'),
      }),
    },
  );
}

/**
 * The object-write tool set — empty for an agent with no object types, since
 * there is nothing it could write.
 * @param ctx
 */
export function updateObjectTools(ctx: RuntimeContext): StructuredToolInterface[] {
  // The page's record is always writable (`recordWrite.ts`), so an agent with
  // no object types still has the tool while a record is on the page.
  if (ctx.objectTypeSlugs.length === 0 && pageRecordIds(ctx).length === 0) {
    return [];
  }
  return [updateObjectTool(ctx)];
}
