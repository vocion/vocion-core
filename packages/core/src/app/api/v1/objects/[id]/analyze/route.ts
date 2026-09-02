import type { RuntimeContext } from '@/services/agents/types';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/libs/DB';
import { businessObjectSchema } from '@/models/Schema';
import { withToolCallRecord } from '@/services/agents/toolCallRecord';
import { kitVisionTools } from '@/services/agents/tools/kitVision';
import { authApi, isErrorResponse, jsonError, readIdParam } from '../../../_shared';

export const maxDuration = 120;

/**
 * POST /api/v1/objects/[id]/analyze?classifier=1
 *
 * Run the vision check on an image-backed object from the UI — the same tool
 * path the Pack Inspector takes in chat (reference comparison, plus the
 * Rekognition second opinion when `classifier=1`), recorded as tool_call
 * rows and upserted onto the same inspection record. The caller is stamped
 * as the invoker so the activity trail says who pressed the button.
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
  const obj = await db.query.businessObjectSchema.findFirst({
    where: and(eq(businessObjectSchema.id, id), eq(businessObjectSchema.orgId, caller.orgId)),
  });
  if (!obj) {
    return jsonError('NOT_FOUND', 'object not found', 404);
  }
  const imageKey = obj.metadata?.image_key;
  if (typeof imageKey !== 'string') {
    return jsonError('BAD_REQUEST', 'this object has no image_key to analyze', 400);
  }
  const wantClassifier = new URL(req.url).searchParams.get('classifier') === '1';

  const rctx: RuntimeContext = {
    orgId: caller.orgId,
    userId: caller.actorId,
    agentSlug: 'pack-inspector',
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: { recencyDecay: 0, sourceWeights: {}, maxResults: 8, minRelevance: 0 } as RuntimeContext['searchConfig'],
    harnessConfig: { provider: 'local', grantTools: ['vision_compare_reference', 'vision_detect_labels'] },
    provider: 'local',
    emit: () => {},
    citationSeq: { current: 0 },
  };
  const tools = kitVisionTools(rctx).map(t => withToolCallRecord(t as never, rctx));
  const compare = tools.find(t => t.name === 'vision_compare_reference');
  const classify = tools.find(t => t.name === 'vision_detect_labels');
  if (!compare) {
    return jsonError('UNAVAILABLE', 'vision tools are not available', 503);
  }

  const started = Date.now();
  try {
    const reference = JSON.parse(String(await compare.invoke({ image_key: imageKey }))) as Record<string, unknown>;
    let classifier: Record<string, unknown> | null = null;
    if (wantClassifier && classify) {
      classifier = JSON.parse(String(await classify.invoke({ image_key: imageKey }))) as Record<string, unknown>;
    }
    if (reference.error) {
      return jsonError('ANALYSIS_FAILED', String(reference.error), 502, { reference });
    }
    return NextResponse.json({ ok: true, ms: Date.now() - started, reference, classifier });
  } catch (err) {
    return jsonError('ANALYSIS_FAILED', (err as Error).message, 502);
  }
}
