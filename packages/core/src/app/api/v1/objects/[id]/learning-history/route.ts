import { and, eq, ilike, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/libs/DB';
import { businessObjectSchema, learningCandidateSchema } from '@/models/Schema';
import { loadLearningRules } from '@/services/agents/tools/kitVision';
import { authApi, isErrorResponse, jsonError, readIdParam } from '../../../_shared';

/**
 * GET /api/v1/objects/[id]/learning-history
 *
 * What the vision engine knew and what people have taught it since, for one
 * inspection: the adopted learnings in the org (the rules the prompt carries),
 * which of them were applied on the last check, and the learning candidates
 * raised from this record or about its kit (pending / approved / rejected).
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await ctx.params).id, 'object id');
  if (isErrorResponse(id)) {
    return id;
  }
  const obj = await db.query.businessObjectSchema.findFirst({
    where: and(eq(businessObjectSchema.id, id), eq(businessObjectSchema.orgId, caller.orgId)),
  });
  if (!obj) {
    return jsonError('NOT_FOUND', 'object not found', 404);
  }
  const meta = (obj.metadata ?? {}) as Record<string, unknown>;
  const template = typeof meta.template_id === 'string' ? meta.template_id : null;
  const ref = ((meta.checks as Record<string, unknown> | undefined)?.reference ?? {}) as { learnings_applied?: Array<{ id: number; step: string; text: string }>; at?: string; prompt?: { system?: string; user?: string }; usage?: Record<string, unknown>; model?: string };

  const adopted = await loadLearningRules(caller.orgId);
  const candidates = await db.select().from(learningCandidateSchema).where(and(
    eq(learningCandidateSchema.orgId, caller.orgId),
    or(
      eq(learningCandidateSchema.sourceRunId, obj.id),
      ...(template ? [ilike(learningCandidateSchema.ruleText, `%${template}%`)] : []),
    ),
  )).orderBy(learningCandidateSchema.createdAt);

  return NextResponse.json({
    objectId: obj.id,
    template,
    lastCheck: ref.at ? { at: ref.at, model: ref.model ?? null, usage: ref.usage ?? null } : null,
    prompt: ref.prompt ?? null,
    applied: ref.learnings_applied ?? [],
    adopted,
    candidates: candidates.map(c => ({
      id: c.id,
      status: c.status,
      ruleText: c.editedRuleText ?? c.ruleText,
      fromThisRecord: c.sourceRunId === obj.id,
      createdAt: c.createdAt,
      decidedBy: c.decidedBy,
      decidedAt: c.decidedAt,
    })),
  });
}
