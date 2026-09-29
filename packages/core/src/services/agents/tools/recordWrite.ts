/**
 * ONE WAY FOR AN AGENT TO CHANGE A RECORD (backlog 035).
 *
 * A record's body is an artifact, so an agent changes a record the way it
 * changes any artifact: `read_artifact`, edit, `update_artifact`. The write
 * underneath is always `objects.update_meta` — the row, then a new version of
 * the body with who and why, under the workspace's trust rule for that type,
 * done for the person with Undo above the bar and a card in Review below it.
 * `update_object` goes through the same function, so the two tools are one
 * path with two spellings, never two rules.
 *
 * WHICH RECORDS. "Which object types can I write" stopped being a question
 * the agent has to answer (Chris, 2026-09-28, watching the product manager
 * refuse to change the feature on his screen). The record the person is
 * looking at — the page's record, and any record they tagged — is always
 * writable, under `objects.update_meta`'s trust rule; beyond the page, an
 * agent writes the types it was given under `objectTypes:`. Trust, not a
 * tool allowlist, decides whether a person is asked.
 *
 * Every landed write announces itself as a typed `version_written` event on
 * the chat stream, so the page showing that record refreshes and marks what
 * changed (`features/dashboard/versions`).
 */

import type { RuntimeContext } from '../types';
import type { RecordRef } from '@/services/chat/pageContext';
import { guardVisuals } from '@/libs/factory/mockup';
import { ActionError, proposeAction } from '@/services/ActionService';

/** Record-ref types whose id is a `business_object.id`. */
const RECORD_REF_TYPES: ReadonlySet<string> = new Set(['object', 'request']);

/**
 * The records on the person's page: the page's own record first, then every
 * record they tagged. Only refs that name a business object by id.
 * @param ctx - The turn.
 */
export function pageRecordIds(ctx: Pick<RuntimeContext, 'pageContext'>): number[] {
  const refs = [ctx.pageContext?.record, ...(ctx.pageContext?.refs ?? [])];
  const ids: number[] = [];
  for (const ref of refs) {
    if (ref && RECORD_REF_TYPES.has(ref.type) && /^\d+$/.test(ref.id)) {
      const id = Number(ref.id);
      if (id > 0 && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * May this agent write this record? The page's records always; otherwise the
 * types under its `objectTypes:`. Whether a PERSON must approve is the trust
 * rule's call, made later by `objects.update_meta`.
 * @param ctx - The turn.
 * @param objectType - The record's type slug.
 * @param id - The record.
 */
export function recordWritable(ctx: Pick<RuntimeContext, 'pageContext' | 'objectTypeSlugs'>, objectType: string, id: number): boolean {
  return ctx.objectTypeSlugs.includes(objectType) || pageRecordIds(ctx).includes(id);
}

/**
 * Why a write was refused before it was proposed, in words the agent can act on.
 * @param ctx
 * @param objectType
 * @param id
 */
export function notWritableMessage(ctx: Pick<RuntimeContext, 'objectTypeSlugs'>, objectType: string, id: number): string {
  const types = ctx.objectTypeSlugs;
  return `Refused: ${objectType} #${id} is not on the person's page, and this agent does not work with "${objectType}" records${types.length ? ` (it may write: ${types.join(', ')})` : ''}. Ask the person to open the record, or add the type under objectTypes in the agent's YAML.`;
}

export type RecordWriteResult = Awaited<ReturnType<typeof proposeAction>> & {
  /** The body artifact's version before and after, when the write landed. */
  version?: { artifactId: number; from: number | null; to: number };
};

/**
 * Write fields on a record as this agent, through `objects.update_meta`, and
 * announce the new version when it landed.
 * @param ctx - The turn.
 * @param input - The write.
 * @param input.objectType - The record's type slug.
 * @param input.id - The record.
 * @param input.set - The fields, by name; null clears.
 * @param input.reason - Why, in a sentence a person can check.
 * @param input.confidence - 0–1; decides done-for-you or Review under the trust rule.
 * @param input.label - The record as the person knows it, for the event ("request #214").
 * @param input.ownsVisualIds - The mockup tool's own write: `visuals` ids are its to set, so they are not guarded.
 */
export async function writeRecordAsAgent(ctx: RuntimeContext, input: { objectType: string; id: number; set: Record<string, unknown>; reason: string; confidence: number; label?: string; ownsVisualIds?: boolean }): Promise<RecordWriteResult> {
  const set = input.ownsVisualIds || !('visuals' in input.set) ? input.set : await guardedVisualsSet(ctx, input.id, input.set);
  const res = await proposeAction({
    orgId: ctx.orgId,
    actionId: 'objects.update_meta',
    input: { objectType: input.objectType, id: input.id, set, reason: input.reason },
    principal: {
      kind: 'agent',
      id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : 'agent:unknown',
      scope: { orgId: ctx.orgId },
      grants: ['*'],
      autonomy: 2,
    },
    invokedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : ctx.userId,
    proposal: {
      confidence: input.confidence,
      rationale: input.reason,
      agentSlug: ctx.agentSlug,
      suggestedDecision: 'approve',
      suggestedDecisionReason: input.reason.slice(0, 160),
    },
  });
  const version = res.status === 'done' ? versionOf(res.result) : null;
  if (version) {
    ctx.emit({
      type: 'version_written',
      ref: { type: 'object', id: String(input.id), label: input.label ?? `${input.objectType.replace(/[_-]+/g, ' ')} #${input.id}` } satisfies RecordRef,
      artifactId: version.artifactId,
      from: version.from,
      to: version.to,
      fields: Object.keys(set).sort(),
    });
  }
  return version ? { ...res, version } : res;
}

/**
 * A hand-written `visuals`, checked and completed (`guardVisuals`): the
 * screenshot and mockup ids are the mockup tool's to write, so a different
 * list is refused, and keys the write left out are carried over from the
 * record — `visuals` is written whole, and setting `surfaceUrl` once dropped
 * the pictures beside it. Request #224, 2026-09-29: the designer typed the
 * AFTER mockup's id into `beforeArtifactIds` by hand.
 * @param ctx - The turn.
 * @param id - The record.
 * @param set - The write.
 */
async function guardedVisualsSet(ctx: RuntimeContext, id: number, set: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { getBusinessObject } = await import('@/services/BusinessObjectService');
  const row = await getBusinessObject(id, ctx.orgId);
  const current = ((row?.metadata ?? {}) as Record<string, unknown>).visuals;
  const checked = guardVisuals(current, set.visuals);
  if (!checked.ok) {
    throw new ActionError('VALIDATION_FAILED', checked.reason);
  }
  if (checked.value === null) {
    return set;
  }
  return { ...set, visuals: checked.value };
}

/**
 * The body version an `objects.update_meta` result carries, when it wrote one.
 * @param result - The action's result.
 */
export function versionOf(result: unknown): { artifactId: number; from: number | null; to: number } | null {
  const r = (result ?? {}) as { bodyArtifactId?: unknown; bodyVersion?: unknown; bodyFrom?: unknown };
  if (typeof r.bodyArtifactId !== 'number' || typeof r.bodyVersion !== 'number') {
    return null;
  }
  return { artifactId: r.bodyArtifactId, from: typeof r.bodyFrom === 'number' ? r.bodyFrom : null, to: r.bodyVersion };
}

/* ------------------------------------------------------------------ */
/* update_artifact on a record's body                                  */
/* ------------------------------------------------------------------ */

/** The artifact fields `reviseRecordBody` reads. */
export type BodyArtifact = { id: number; recordType: string | null; recordId: string | null; recordRole: string | null };

/**
 * `update_artifact` on a record's body: the edited body read back into
 * fields (`recordBodyParse.ts`), and the difference written through
 * `objects.update_meta` — plus `objects.rename` when the heading changed —
 * so the row and the version can never disagree. Returns what the tool
 * says to the model.
 * @param ctx - The turn.
 * @param body - The body artifact.
 * @param args - What `update_artifact` was given.
 * @param args.spec - A whole spec; `spec.record.fields` is read as the fields, else `spec.md` as the body.
 * @param args.contentMarkdown - The edited body.
 * @param args.title - A new title.
 * @param args.changeSummary - The version's line, in the past tense — the write's reason.
 * @param args.confidence - 0–1.
 */
export async function reviseRecordBody(ctx: RuntimeContext, body: BodyArtifact, args: { spec?: unknown; contentMarkdown?: string | null; title?: string | null; changeSummary: string; confidence?: number }): Promise<string> {
  const objectId = Number(body.recordId);
  const { getBusinessObject } = await import('@/services/BusinessObjectService');
  const rec = await getBusinessObject(objectId, ctx.orgId);
  if (!rec?.type) {
    return `The record behind artifact #${body.id} (#${objectId}) is gone, so there is nothing to change.`;
  }
  const typeSlug = rec.type.slug;
  const label = `${rec.type.label.toLowerCase()} #${rec.id}`;
  if (!recordWritable(ctx, typeSlug, rec.id)) {
    return notWritableMessage(ctx, typeSlug, rec.id);
  }
  const schema = (rec.type.schema ?? null) as Record<string, unknown> | null;
  const { recordFields } = await import('@/services/objects/recordBodyFormat');
  const { parseRecordBody, setBetween } = await import('@/services/objects/recordBodyParse');
  const current = recordFields((rec.metadata ?? {}) as Record<string, unknown>, schema as never);
  const spec = (args.spec && typeof args.spec === 'object' ? args.spec : null) as { md?: unknown; title?: unknown; record?: { fields?: unknown } } | null;
  let next = current;
  let title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : null;
  try {
    if (spec?.record?.fields && typeof spec.record.fields === 'object' && !Array.isArray(spec.record.fields)) {
      next = spec.record.fields as Record<string, unknown>;
      title ??= typeof spec.title === 'string' ? spec.title.trim() : null;
    } else {
      const md = args.contentMarkdown ?? (typeof spec?.md === 'string' ? spec.md : null);
      if (md !== null) {
        const parsed = parseRecordBody(md, schema as never, current);
        next = parsed.fields;
        title ??= parsed.title;
      }
    }
  } catch (err) {
    return `update_artifact rejected: ${(err as Error).message} Read the artifact again and send the body back in the same shape.`;
  }
  const set = setBetween(current, next);
  const renamed = title && title !== rec.title ? title : null;
  if (Object.keys(set).length === 0 && !renamed) {
    return `Nothing changed: the body you sent says what ${label} already says. Read it again (read_artifact) and edit the part the person asked about.`;
  }
  const confidence = typeof args.confidence === 'number' && args.confidence >= 0 && args.confidence <= 1 ? args.confidence : 0.5;
  const lines: string[] = [];
  try {
    if (Object.keys(set).length > 0) {
      const res = await writeRecordAsAgent(ctx, { objectType: typeSlug, id: rec.id, set, reason: args.changeSummary, confidence, label });
      const fields = Object.keys(set).join(', ');
      if (res.status === 'done') {
        lines.push(`${label} "${rec.title}" changed — ${fields} written (run #${res.runId})${res.version ? `, now version ${res.version.to} of its history` : ''}. Done for you; the person sees it on the page and can Undo. Do NOT repeat the record as text.`);
      } else if (res.status === 'pending') {
        lines.push(`The change to ${label} (${fields}) is PENDING a person's decision (run #${res.runId}, under the trust rule for objects.update_meta.${typeSlug}). Do NOT say it changed — say it is waiting in Review.`);
      } else {
        lines.push(`The change to ${label} did not land (run #${res.runId} is ${res.status}${res.error ? `: ${res.error}` : ''}).`);
      }
    }
    if (renamed) {
      const res = await renameRecordAsAgent(ctx, { objectType: typeSlug, id: rec.id, title: renamed, reason: args.changeSummary, confidence, label });
      lines.push(res.status === 'done' ? `Renamed to "${renamed}" (run #${res.runId}).` : res.status === 'pending' ? `The rename to "${renamed}" is waiting in Review (run #${res.runId}).` : `The rename did not land (run #${res.runId} is ${res.status}).`);
    }
  } catch (err) {
    if (err instanceof ActionError) {
      return `update_artifact rejected (${err.code}): ${err.message}`;
    }
    return `Could not change ${label}: ${(err as Error).message}`;
  }
  return lines.join(' ');
}

async function renameRecordAsAgent(ctx: RuntimeContext, input: { objectType: string; id: number; title: string; reason: string; confidence: number; label: string }) {
  const res = await proposeAction({
    orgId: ctx.orgId,
    actionId: 'objects.rename',
    input: { objectType: input.objectType, id: input.id, title: input.title, reason: input.reason },
    principal: { kind: 'agent', id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : 'agent:unknown', scope: { orgId: ctx.orgId }, grants: ['*'], autonomy: 2 },
    invokedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : ctx.userId,
    proposal: { confidence: input.confidence, rationale: input.reason, agentSlug: ctx.agentSlug, suggestedDecision: 'approve', suggestedDecisionReason: input.reason.slice(0, 160) },
  });
  const version = res.status === 'done' ? versionOf(res.result) : null;
  if (version) {
    ctx.emit({ type: 'version_written', ref: { type: 'object', id: String(input.id), label: input.label }, artifactId: version.artifactId, from: version.from, to: version.to, fields: [] });
  }
  return res;
}
