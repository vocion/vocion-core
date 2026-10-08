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
import type { WorkFacts } from '@/libs/factory/workFacts';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { nowLine } from '@/libs/factory/liveStatus';
import { noteRead } from '@/services/access/accessLog';
import { getBusinessObject } from '@/services/BusinessObjectService';
import { codeForRecord } from '@/services/codes';
import { readRecovery } from '@/services/factory/recovery';
import { loadRecordStatus } from '@/services/objects/recordStatus';
import { recordIdArg, recordIdOf } from './recordIdArg';

/**
 * THE RECORD'S HISTORY, COUNTED, AT THE TOP.
 *
 * Conversation 364 (2026-09-29 05:12Z): the product manager read request
 * #224 and said "the plan gate has fired twice" — true: action runs 5016
 * (03:22:41Z) and 5018 (03:23:09Z), both logged on `metadata.recovery`.
 * On "go" the next turn disowned it ("That wasn't in the record; I asserted
 * it … No gate") — false. The record was 3,452 characters and `recovery`
 * began at character 1,225; the replay of that read keeps 1,200
 * (`chat/historyTools.ts`), so the next turn saw a record with no history in
 * it and believed the cut. The history is now counted and dated in a few
 * hundred characters before the fields, so it survives any cut and no turn
 * has to count log lines to state it.
 * @param meta - The record's metadata.
 */
export function recoverySummary(meta: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta.recovery || typeof meta.recovery !== 'object') {
    return undefined;
  }
  const r = readRecovery(meta);
  if (r.log.length === 0 && r.attempts.length === 0) {
    return undefined;
  }
  const byKind: Record<string, number> = {};
  for (const a of r.attempts) {
    byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
  }
  const last = r.attempts.at(-1);
  return {
    from: 'metadata.recovery — the factory\'s own account of this record; these counts are exact',
    automaticAttempts: r.attempts.length,
    ...(r.attempts.length > 0 ? { byKind, attemptsAt: r.attempts.map(a => `${a.kind} #${a.n} at ${a.at}${a.runId ? ` (run ${a.runId})` : ''}`) } : {}),
    ...(last ? { lastAttemptWhy: last.line.slice(0, 200) } : {}),
    countedSince: r.since ?? 'the record was filed',
    limit: r.limit,
    stage: r.stage,
    logEntries: r.log.length,
    ...(r.log.length > 0 ? { firstLoggedAt: r.log[0]!.at, lastLoggedAt: r.log.at(-1)!.at } : {}),
  };
}

/**
 * The delivery facts as an agent reads them: each on its own typed field, with
 * the line it reads as (`libs/factory/workFacts.ts`, backlog 044). A finished
 * run is not a merge, a merge is not a release, and "not reported" is not a
 * pass — each field says only what its record says.
 * @param f - The report's facts.
 */
function factsForAgent(f: WorkFacts): Record<string, unknown> {
  return {
    request: { id: f.request.id, stage: f.request.stage, recordState: f.request.recordState, line: f.request.line },
    attempt: f.taskId === null ? null : { taskId: f.taskId },
    verdict: { value: f.verdict.value, proven: f.verdict.proven, total: f.verdict.total, line: f.verdict.line },
    pullRequest: { url: f.pullRequest.url, merge: f.pullRequest.merge, line: f.pullRequest.line },
    ci: { state: f.ci.state, failedChecks: f.ci.failedChecks, line: f.ci.line },
    mergeRule: { runsItself: f.mergeRule.runsItself, riskClass: f.mergeRule.riskClass, line: f.mergeRule.line },
    shipped: f.shipped,
    next: f.next,
  };
}

/**
 * The record's three-line status for an agent: the stage, whether it needs a
 * person, what is running (as a line and as the run), and what is next — and
 * the delivery facts under it.
 * @param orgId - Tenant.
 * @param id - The record.
 */
export async function liveStatusOf(orgId: string, id: number): Promise<Record<string, unknown> | null> {
  try {
    const read = await loadRecordStatus(orgId, id);
    if (!read.ok) {
      return null;
    }
    const s = read.status;
    return {
      stage: s.stage.label,
      you: s.you.line,
      ...(s.you.why ? { why: s.you.why } : {}),
      now: nowLine(s.live, new Date(s.readAt)),
      ...(s.live ? { run: { label: s.live.runLabel, href: s.live.runHref, since: s.live.startedAt } } : {}),
      next: s.next,
      ...(s.facts ? { facts: factsForAgent(s.facts) } : {}),
    };
  } catch {
    return null;
  }
}

export function readObjectTool(ctx: RuntimeContext) {
  const readable = ctx.objectTypeSlugs;
  return tool(
    async (raw) => {
      const { object_type, id: named } = raw as { object_type: string; id: number | string };
      if (!readable.includes(object_type)) {
        return `Refused: this agent does not work with "${object_type}" records. It may read: ${readable.join(', ')}.`;
      }
      const ref = await recordIdOf(ctx.orgId, named);
      if ('reason' in ref) {
        return `${ref.reason}. Use lookup_objects to find it; a record is named by its code (FE-294), not a name.`;
      }
      const id = ref.id;
      const row = await getBusinessObject(id, ctx.orgId);
      if (!row) {
        return `No record ${typeof named === 'string' && /[a-z]/i.test(named) ? named.toUpperCase() : `#${id}`} in this workspace. Use lookup_objects to find it; a record is named by its code (FE-294), not a name.`;
      }
      const slug = (row as { type?: { slug?: string } }).type?.slug;
      const code = await codeForRecord(ctx.orgId, id).catch(() => null) ?? `#${id}`;
      if (slug !== undefined && slug !== object_type) {
        return `${code} is a "${slug}", not a "${object_type}". Read it as its own type.`;
      }
      // The whole record as JSON, which is what a caller that asked for one
      // record in full wants. It is data to work from, never text to paste
      // back — the same rule lookup_objects carries. The record's history
      // comes counted, up front (`recoverySummary`).
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const summary = recoverySummary(meta);
      // WHERE IT IS NOW, the same read its page draws (parity rule): for a
      // record whose type has a report page, You / Now / Next. A status that
      // cannot be read is left off rather than failing the read.
      const live = await liveStatusOf(ctx.orgId, row.id);
      // A field the type derives from other records (`x-derived`) reads as
      // those records say, the same value its page shows; a stored value
      // that disagrees comes back as drift, never in its place.
      const { derivedFieldsOf } = await import('@/services/objects/related');
      const derived = await derivedFieldsOf(ctx.orgId, row.id).catch(() => ({ values: {}, drift: {} }));
      noteRead({ action: 'view', record: { kind: 'object', id: row.id } });
      return JSON.stringify({
        id: row.id,
        code,
        title: row.title,
        status: row.status,
        ...(live ? { liveStatus: live } : {}),
        ...(summary ? { recoverySummary: summary } : {}),
        ...meta,
        ...derived.values,
        ...(Object.keys(derived.drift).length > 0 ? { derivedDrift: derived.drift } : {}),
      });
    },
    {
      name: 'read_object',
      description: 'Read ONE record in full, every field whole. Use it when you need what a field actually says — lookup_objects truncates every value to 120 characters so it can list many, which is the right shape for scanning and the wrong one for working. Find it with lookup_objects first; name it by its code (FE-294) or id. Data to work from; never paste it back verbatim.',
      schema: z.object({
        object_type: z.string().min(1).describe(`The object type slug. One of: ${readable.join(', ')}.`),
        id: recordIdArg('The record (from lookup_objects)'),
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
