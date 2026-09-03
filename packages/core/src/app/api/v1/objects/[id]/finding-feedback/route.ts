import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/libs/DB';
import { businessObjectSchema, learningStepSchema } from '@/models/Schema';
import { updateBusinessObject } from '@/services/BusinessObjectService';
import { createCandidate } from '@/services/LearningCandidateService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';

type Finding = Record<string, unknown> & {
  region?: string;
  issue?: string;
  expected?: string;
  observed?: string;
  feedback?: { signal: 'agree' | 'disagree'; note?: string | null; by?: string | null; at?: string; learningCandidateId?: number | null };
};

/**
 * POST /api/v1/objects/[id]/finding-feedback
 *
 * A person agrees or disagrees with one model finding on an image-backed
 * object. Body: `{ index, signal: 'agree' | 'disagree', note? }`.
 *
 * Agree stamps the finding. Disagree stamps it AND opens a learning
 * candidate (the workspace's learning step for this object's agents) whose
 * rule text is drafted from the finding + the note — a suggestion in the
 * Learnings queue, never an applied rule. That is the feedback loop: the
 * correction becomes a proposed standard a person adopts.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await ctx.params).id, 'object id');
  if (isErrorResponse(id)) {
    return id;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const index = Number(body.index);
  const signal = body.signal;
  const target = body.target === 'region' ? 'region' : 'finding';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  if (!Number.isInteger(index) || index < 0 || (signal !== 'agree' && signal !== 'disagree')) {
    return jsonError('BAD_REQUEST', 'index (integer) and signal (agree|disagree) are required', 400);
  }
  if (signal === 'disagree' && !note) {
    return jsonError('BAD_REQUEST', 'a note is required when disagreeing — it becomes the proposed rule', 400);
  }

  const obj = await db.query.businessObjectSchema.findFirst({
    where: and(eq(businessObjectSchema.id, id), eq(businessObjectSchema.orgId, caller.orgId)),
    with: { type: true },
  });
  if (!obj) {
    return jsonError('NOT_FOUND', 'object not found', 404);
  }
  const meta = { ...(obj.metadata ?? {}) } as Record<string, unknown>;
  const findings = Array.isArray(meta.findings) ? ([...(meta.findings as Finding[])]) : [];
  const regions = Array.isArray(meta.regions) ? ([...(meta.regions as Finding[])]) : [];
  const finding = target === 'region' ? regions[index] : findings[index];
  if (!finding) {
    return jsonError('NOT_FOUND', `no ${target} at index ${index}`, 404);
  }

  let learningCandidateId: number | null = null;
  if (signal === 'disagree') {
    // The first learning step in this org is the shared rule bucket; fall
    // back to a generic name so the candidate still lands in the queue.
    const step = await db.query.learningStepSchema.findFirst({ where: eq(learningStepSchema.orgId, caller.orgId) });
    const kit = typeof meta.template_id === 'string' ? meta.template_id : 'this kit';
    const ruleText = target === 'region'
      ? [
          `Missed defect on ${kit}, region ${finding.region ?? 'unknown'}: the model marked it OK (${finding.observed ?? 'matched the references'}),`,
          `but the reviewer found a problem — ${note}`,
          `When judging ${finding.region ?? 'that region'} on ${kit}, check for this before calling it OK.`,
        ].join(' ')
      : [
          `Reviewer correction on ${kit}, region ${finding.region ?? 'unknown'} (${finding.issue ?? 'issue'}):`,
          `the model saw "${finding.observed ?? ''}" and expected "${finding.expected ?? ''}", but the reviewer disagreed —`,
          `${note}`,
          `Apply this when judging ${finding.region ?? 'that region'} on ${kit}.`,
        ].join(' ');
    const candidate = await createCandidate({
      orgId: caller.orgId,
      stepName: step?.name ?? 'general',
      ruleText,
      sourceRunId: obj.id,
    });
    learningCandidateId = candidate.id;
  }

  const stamp = { signal: signal as 'agree' | 'disagree', note: note || null, by: caller.actorId, at: new Date().toISOString(), learningCandidateId };
  let status: string | undefined;
  let extra: Record<string, unknown> = {};
  if (target === 'region') {
    regions[index] = { ...finding, feedback: stamp };
    if (signal === 'disagree') {
      // A missed defect: promote the region to a blocking finding and hold
      // the kit as a reviewer decision. The model's verdict stays on record.
      regions[index] = { ...regions[index], issue: 'missed' };
      findings.push({ ...finding, issue: 'missed', severity: 'blocking', expected: finding.observed ?? 'as in the references', observed: note, confidence: undefined, feedback: stamp });
      status = 'held';
      extra = { reviewer_override: { verdict: 'hold', reason: note, by: caller.actorId, at: stamp.at, region: finding.region ?? null } };
    }
  } else {
    findings[index] = { ...finding, feedback: stamp };
  }
  const all = [...findings, ...regions];
  const agreeCount = all.filter(f => f.feedback?.signal === 'agree').length;
  const disagreeCount = all.filter(f => f.feedback?.signal === 'disagree').length;
  await updateBusinessObject({
    id: obj.id,
    ...(status ? { status } : {}),
    metadata: { ...meta, ...extra, findings, regions, finding_feedback: { agree: agreeCount, disagree: disagreeCount, last_at: stamp.at } },
  }, caller.orgId);

  return NextResponse.json({ ok: true, findings, regions, status: status ?? obj.status, learningCandidateId });
}
