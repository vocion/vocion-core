/**
 * EVERY NEW FEATURE WITH A UI GETS ITS MOCKUP, HANDS-OFF — the half that
 * reads and writes. The decisions are pure, in `libs/factory/mockupDefault.ts`.
 *
 *   object.created / object.updated  → requestDefaultMockup  owed? mark it drawing, raise `mockup.requested`
 *   mockup.requested                 → (the plugin's designer draws it with draw_mockup)
 *   automation_run.completed/.failed → defaultMockupEnded    drawn, or once more with the reason, or written down
 *
 * Nothing here names a type, a field the plugin owns, an agent or a tool: the
 * rule rides the automation's `do.input`, the record's type comes from the
 * event, and the tool the drawing had to call is read off the automation that
 * drew it (`do.requireTool`).
 */

import type { MockupDraw, MockupRule } from '@/libs/factory/mockupDefault';
import { mockupAfterRun, mockupDecision, MockupRuleSchema } from '@/libs/factory/mockupDefault';

type Meta = Record<string, unknown>;

/** What a step did, for the job's result and the automation log. */
export type MockupStepResult = { recordId: number | null; did: string; line: string | null };

const skip = (recordId: number | null, did: string): MockupStepResult => ({ recordId, did, line: null });

/**
 * The plugin's rule off the job's input, or why there is none.
 * @param input - The automation's `do.input` merged with the event payload.
 */
function ruleOf(input: Record<string, unknown>): MockupRule | { error: string } {
  const parsed = MockupRuleSchema.safeParse(input);
  return parsed.success ? parsed.data : { error: `the automation's do.input carries no mockup rule (owedWhen: {field, oneOf}): ${parsed.error.issues[0]?.message ?? 'invalid'}` };
}

/**
 * Write where the drawing stands onto `visuals.mockupDraw`, touching nothing
 * else in `visuals` — a mockup landing at the same moment is never clobbered.
 * @param orgId - Tenant.
 * @param id - The record.
 * @param mark - The state.
 */
async function writeMark(orgId: string, id: number, mark: MockupDraw): Promise<void> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const m = businessObjectSchema.metadata;
  await db
    .update(businessObjectSchema)
    .set({
      metadata: sql`jsonb_set(coalesce(${m}, '{}'::jsonb), '{visuals}', coalesce(${m} -> 'visuals', '{}'::jsonb) || jsonb_build_object('mockupDraw', ${JSON.stringify(mark)}::jsonb))`,
      updatedAt: new Date(),
    })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

/**
 * One line on the record's own account (the feature page's Activity).
 * Best-effort: the mark on the record is the fact; the line is the telling.
 * @param orgId - Tenant.
 * @param id - The record.
 * @param line - What happened.
 */
async function noteLine(orgId: string, id: number, line: string): Promise<void> {
  const { noteOnRequest } = await import('./carry');
  await noteOnRequest(orgId, id, line).catch(() => undefined);
}

/**
 * Raise `mockup.requested` for one attempt.
 * @param orgId - Tenant.
 * @param record - The record.
 * @param record.id - Its id.
 * @param record.type - Its type slug.
 * @param record.title - Its title.
 * @param attempt - Which attempt.
 * @param lastFailure - Why the last drew nothing, on a retry.
 * @param at - When, for the dedupe key.
 */
async function requestDrawing(orgId: string, record: { id: number; type: string; title: string }, attempt: number, lastFailure: string | undefined, at: string): Promise<void> {
  const { emitEvent, MOCKUP_REQUESTED } = await import('@/services/EventService');
  await emitEvent({
    orgId,
    type: MOCKUP_REQUESTED,
    payload: { recordId: record.id, recordType: record.type, title: record.title, attempt, ...(lastFailure ? { lastFailure } : {}) },
    dedupeKey: `${MOCKUP_REQUESTED}:${record.id}:${attempt}:${at}`,
    // A step of the system's, not a person's turn and not an agent's own
    // judgement; no causal chain is carried, so the drawing's own fire is
    // never refused as its own trigger on the retry.
    invokedBy: 'job:mockup-default',
    dispatchMode: 'auto',
  });
}

/**
 * A record was filed, or written: when the plugin's rule says it owes a
 * mockup and it has none, mark it drawing and ask for one. Never waits on
 * the drawing, never holds the filing.
 * @param orgId - Tenant.
 * @param input - The `object.created` / `object.updated` payload with the rule.
 * @param now - The clock.
 */
export async function requestDefaultMockup(orgId: string, input: Record<string, unknown>, now: Date = new Date()): Promise<MockupStepResult> {
  const id = Number(input.objectId);
  if (!Number.isInteger(id) || id <= 0) {
    return skip(null, 'no record named');
  }
  const rule = ruleOf(input);
  if ('error' in rule) {
    console.warn('[mockup-default] no rule', { orgId, id, error: rule.error });
    return skip(id, rule.error);
  }
  const { getBusinessObject } = await import('@/services/BusinessObjectService');
  const row = await getBusinessObject(id, orgId);
  if (!row?.type || (typeof input.objectType === 'string' && row.type.slug !== input.objectType)) {
    return skip(id, 'not the record the event named');
  }
  // Where a mockup lands is the mockup tool's own field (`libs/factory/mockup.ts`);
  // a type without it has nowhere to put one.
  const props = ((row.type.schema ?? {}) as { properties?: Record<string, { properties?: Record<string, unknown> }> }).properties ?? {};
  if (!props.visuals?.properties?.mockupArtifactIds) {
    return skip(id, `${row.type.slug} carries no visuals.mockupArtifactIds`);
  }
  const meta = (row.metadata ?? {}) as Meta;
  const changed = typeof input.fields === 'string' ? input.fields.split(',').map(f => f.trim()).filter(Boolean) : null;
  const decision = mockupDecision(meta, rule, now, changed);
  if (decision.do === 'skip') {
    return skip(id, decision.why);
  }
  // After the installation could not draw (or a failure of no recorded
  // kind): only when it can now, so a still-broken one spends no run. Once it
  // can, the operator's ask closes.
  if (decision.needsRenderer) {
    const { renderAvailable } = await import('@/libs/documents/render');
    const ready = await renderAvailable().catch(() => ({ ok: false as const, reason: 'unknown' }));
    if (!ready.ok) {
      return skip(id, 'this installation still cannot draw');
    }
    await closeInfrastructureAsks(orgId, 'This installation can draw images again; the mockups it owed are being drawn.');
  }
  const at = now.toISOString();
  await writeMark(orgId, id, { state: 'drawing', attempt: decision.attempt, at, ...(decision.lastFailure ? { reason: decision.lastFailure } : {}) });
  try {
    await requestDrawing(orgId, { id, type: row.type.slug, title: row.title }, decision.attempt, decision.lastFailure, at);
  } catch (err) {
    // The ask itself failed: say so on the record, where the page reads it.
    const reason = `the drawing could not be started (${(err as Error).message.split('\n')[0]})`;
    await writeMark(orgId, id, { state: 'failed', attempt: decision.attempt, at, reason, cause: 'infrastructure' });
    await noteLine(orgId, id, `The mockup was not drawn: ${reason}.`);
    return { recordId: id, did: 'failed-to-start', line: reason };
  }
  return { recordId: id, did: `requested:${decision.attempt}`, line: null };
}

/**
 * The tool's last answer in a run, when it did not land — the words the
 * designer was refused with, as the tool wrote them.
 * @param orgId - Tenant.
 * @param missionRunId - The run.
 * @param tool - The tool the drawing had to call.
 */
export async function lastToolAnswer(orgId: string, missionRunId: number, tool: string): Promise<{ called: boolean; answer: string | null }> {
  const { and, desc, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { toolCallSchema } = await import('@/models/Schema');
  const [row] = await db
    .select({ output: toolCallSchema.output, error: toolCallSchema.error, input: toolCallSchema.input })
    .from(toolCallSchema)
    .where(and(eq(toolCallSchema.orgId, orgId), eq(toolCallSchema.missionRunId, missionRunId), eq(toolCallSchema.tool, tool)))
    .orderBy(desc(toolCallSchema.createdAt), desc(toolCallSchema.id))
    .limit(1);
  if (!row) {
    return { called: false, answer: null };
  }
  const text = row.error ?? (typeof row.output === 'string' ? row.output : JSON.stringify(row.output ?? ''));
  return { called: true, answer: text.replace(/^"|"$/g, '').split('\n').filter(Boolean).slice(0, 3).join(' ').slice(0, 300) || null };
}

/**
 * The drawing's fire ended (`automation_run.completed` or `.failed`): drawn,
 * tried once more carrying why the first drew nothing, or — after the last
 * attempt — the reason written on the record, where the feature page shows it.
 * @param orgId - Tenant.
 * @param input - The event payload (`automationRunId`, and `error` on a failure) with the rule.
 * @param now - The clock.
 */
export async function defaultMockupEnded(orgId: string, input: Record<string, unknown>, now: Date = new Date()): Promise<MockupStepResult> {
  const runId = Number(input.automationRunId);
  if (!Number.isInteger(runId) || runId <= 0) {
    return skip(null, 'no fire named');
  }
  const attempts = MockupRuleSchema.shape.attempts.safeParse(input.attempts).data ?? 2;
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationRunSchema, automationSchema } = await import('@/models/Schema');
  const [run] = await db
    .select({ slug: automationRunSchema.slug, input: automationRunSchema.input, status: automationRunSchema.status, error: automationRunSchema.error, targetRunId: automationRunSchema.targetRunId })
    .from(automationRunSchema)
    .where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.id, runId)))
    .limit(1);
  const fired = (run?.input ?? {}) as Meta;
  const id = Number(fired.recordId);
  if (!run || !Number.isInteger(id) || id <= 0) {
    return skip(null, 'no record on the fire');
  }
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  const record = await readRecord(orgId, id);
  if (!record) {
    return skip(id, 'the record is gone');
  }
  // WHY IT DREW NOTHING, from the fire itself: its error, else the tool's own
  // last answer in the run, else that it never called the tool at all.
  let reason = typeof input.error === 'string' && input.error.trim() !== '' ? input.error : run.error ?? '';
  if (!reason && run.targetRunId) {
    const [auto] = await db.select({ doConfig: automationSchema.doConfig }).from(automationSchema).where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, run.slug))).limit(1);
    const tool = (auto?.doConfig as { requireTool?: string } | undefined)?.requireTool?.split(':')[0];
    if (tool) {
      const last = await lastToolAnswer(orgId, run.targetRunId, tool);
      reason = !last.called
        ? `the drawing run ended without calling ${tool}`
        : `its last ${tool} call drew nothing — ${last.answer ?? 'it answered nothing'}`;
    }
  }
  const next = mockupAfterRun(record.meta, { attempts }, { reason: reason || 'the drawing ended without a mockup', automationRunId: runId, attempt: Number(fired.attempt) || undefined }, now);
  if (next.do === 'done') {
    return skip(id, next.why);
  }
  await writeMark(orgId, id, next.mark);
  await noteLine(orgId, id, next.line);
  if (next.do === 'retry') {
    await requestDrawing(orgId, { id, type: record.typeSlug, title: record.title }, next.attempt, next.mark.reason, next.mark.at).catch(async (err) => {
      const why = `the retry could not be started (${(err as Error).message.split('\n')[0]})`;
      await writeMark(orgId, id, { ...next.mark, state: 'failed', reason: why, cause: 'infrastructure' });
    });
    return { recordId: id, did: `retry:${next.attempt}`, line: next.line };
  }
  return { recordId: id, did: 'gave-up', line: next.line };
}

/** Where the operator's ask about an installation that cannot draw is filed (`sourceRef` prefix). */
const INFRA_ASK = 'mockup-infrastructure';

/**
 * The seat that operates this installation, as the plugin names it on the
 * automation that runs the `mockup-ended` job (`do.input.operator`) — read,
 * never written here.
 * @param orgId - Tenant.
 */
async function operatorOf(orgId: string): Promise<string | null> {
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationSchema } = await import('@/models/Schema');
  const rows = await db.select({ doConfig: automationSchema.doConfig }).from(automationSchema).where(eq(automationSchema.orgId, orgId));
  for (const r of rows) {
    const op = r.doConfig?.job === 'mockup-ended' ? r.doConfig.input?.operator : null;
    if (typeof op === 'string' && op.trim() !== '') {
      return op.trim();
    }
  }
  return null;
}

/**
 * Close the operator's open asks about drawing, once the installation can draw.
 * @param orgId - Tenant.
 * @param why - The closing note.
 */
async function closeInfrastructureAsks(orgId: string, why: string): Promise<void> {
  const { and, eq, like } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { askSchema } = await import('@/models/Schema');
  const { supersedeAsk } = await import('@/services/AskService');
  const open = await db.select({ id: askSchema.id }).from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, `${INFRA_ASK}:%`)));
  for (const a of open) {
    await supersedeAsk(orgId, a.id, why).catch(() => undefined);
  }
}

/**
 * THE INSTALLATION COULD NOT DRAW (Chris, 2026-09-30, #269: "mockup was not
 * drawn after 2 attempts" over a missing renderer). The drawing tool hit a
 * failure only the installation's operator can fix (`MockupFailure.cause`):
 *
 *   - the record says so, typed (`visuals.mockupDraw.cause`), so the feature
 *     page tells a person only that it could not be drawn and that it is in
 *     hand — never the technical reason — and the drawing is not retried
 *     into the same wall;
 *   - the operator hears the reason ONCE: one open ask for the whole
 *     installation, however many requests fail while it is open;
 *   - it heals: once the installation can draw, the hourly sweep draws what
 *     was owed and the ask closes (`requestDefaultMockup`).
 * @param orgId - Tenant.
 * @param recordId - The record the drawing was for.
 * @param reason - The failure as the tool had it — the operator's to read.
 * @param now - The clock.
 * @returns Whether an ask was filed now (false: one is already open).
 */
export async function mockupInfrastructureFailed(orgId: string, recordId: number, reason: string, now: Date = new Date()): Promise<{ asked: boolean; askId: number | null }> {
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  const { readMockupDraw } = await import('@/libs/factory/mockupDefault');
  const record = await readRecord(orgId, recordId);
  if (record) {
    const draw = readMockupDraw(record.meta);
    const detail = reason.replace(/\s+/g, ' ').trim().slice(0, 400);
    await writeMark(orgId, recordId, draw?.state === 'drawing'
      ? { ...draw, reason: detail, cause: 'infrastructure' }
      : { state: 'failed', attempt: draw?.attempt ?? 1, at: now.toISOString(), reason: detail, cause: 'infrastructure' });
  }
  const { and, eq, like } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { askSchema } = await import('@/models/Schema');
  const [open] = await db.select({ id: askSchema.id }).from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, `${INFRA_ASK}:%`))).limit(1);
  if (open) {
    return { asked: false, askId: open.id };
  }
  const operator = await operatorOf(orgId);
  const { upsertAsk } = await import('@/services/AskService');
  const { ask } = await upsertAsk({
    orgId,
    createdBy: operator ? `agent:${operator}` : 'system',
    ask: {
      kind: 'approval',
      title: 'Mockups cannot be drawn on this installation',
      body: [
        `Drawing a mockup failed on the installation itself, not on the request: ${reason.replace(/\s+/g, ' ').trim().slice(0, 600)}`,
        'Fix the renderer where the agents run. Every mockup it owed is drawn on its own within the hour once it can draw, and this ask closes by itself.',
      ].join('\n\n'),
      sourceRef: `${INFRA_ASK}:${recordId}:${now.toISOString()}`,
      agentSlug: operator,
      risk: 'medium',
      options: [
        { id: 'approve', label: 'The renderer is fixed', description: 'The owed mockups are drawn on the next sweep.', recommended: true },
        { id: 'reject', label: 'Leave it', description: 'Features go on without mockups until it is fixed.' },
      ],
      objectRefs: record ? [{ type: record.typeSlug, id: String(recordId) }] : [],
      decisionCost: 5,
    },
  });
  return { asked: true, askId: ask.id };
}

/** At most this many drawings asked for in one sweep, so a backlog drains over hours, not at once. */
const SWEEP_DRAWS = 3;
/** Records read per sweep, newest first. */
const SWEEP_SCAN = 40;

/**
 * THE SWEEP: an open record that owes a mockup and never got one is asked
 * for again, on a schedule, so a record filed before the rule, or one a
 * past decision skipped (#277, 2026-09-30), heals without anyone asking.
 * Each record is judged by the same decision as the filing event; a drawing
 * running or given up is left alone.
 * @param orgId - Tenant.
 * @param input - The automation's input: the rule, and `objectType`, the type it sweeps.
 * @param now - The clock.
 */
export async function sweepDefaultMockups(orgId: string, input: Record<string, unknown>, now: Date = new Date()): Promise<{ scanned: number; requested: number[] }> {
  const objectType = typeof input.objectType === 'string' ? input.objectType : null;
  if (!objectType) {
    return { scanned: 0, requested: [] };
  }
  const { and, desc, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const { getObjectTypeBySlug } = await import('@/services/BusinessObjectService');
  const type = await getObjectTypeBySlug(orgId, objectType);
  if (!type) {
    return { scanned: 0, requested: [] };
  }
  const rows = await db.select({ id: businessObjectSchema.id }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, type.id))).orderBy(desc(businessObjectSchema.id)).limit(SWEEP_SCAN);
  const requested: number[] = [];
  for (const row of rows) {
    if (requested.length >= SWEEP_DRAWS) {
      break;
    }
    const out = await requestDefaultMockup(orgId, { ...input, objectId: row.id, objectType }, now).catch(() => null);
    if (out?.did.startsWith('requested:')) {
      requested.push(row.id);
    }
  }
  return { scanned: rows.length, requested };
}
