import type { RuntimeContext } from '@/services/agents/types';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema } from '@/models/Schema';
import { withToolCallRecord } from '@/services/agents/toolCallRecord';
import { kitVisionTools } from '@/services/agents/tools/kitVision';
import { authApi, isErrorResponse, jsonError, readIdParam } from '../../../_shared';

export const maxDuration = 120;

/**
 * POST /api/v1/objects/[id]/analyze?classifier=1
 *
 * Runs the vision check on an image-backed object from the UI — the same tool
 * path the Pack Inspector takes in chat — and STREAMS progress as NDJSON, one
 * JSON object per line, so the page can show the analysis happening:
 *
 *   {"phase":"start", ...} → {"phase":"references", reference_urls…}
 *   → {"phase":"model", model…} → {"phase":"parsed", verdict…} → {"phase":"saved"}
 *   → {"phase":"classifier", …} (when ?classifier=1)
 *   → {"phase":"done", "ok":true, "reference":{…}, "classifier":{…}, "ms":n}
 *
 * Errors end the stream with {"phase":"done","ok":false,"error":"…"}. Every
 * tool call is recorded as a tool_call row with the caller as invoker.
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify({ t: Date.now(), ...o })}\n`));
      const started = Date.now();
      const rctx: RuntimeContext = {
        orgId: caller.orgId,
        userId: caller.actorId,
        agentSlug: 'pack-inspector',
        connectorSources: [],
        objectTypeSlugs: [],
        searchConfig: { recencyDecay: 0, sourceWeights: {}, maxResults: 8, minRelevance: 0 } as RuntimeContext['searchConfig'],
        harnessConfig: { provider: 'local', grantTools: ['vision_compare_reference', 'vision_detect_labels'] },
        provider: 'local',
        emit: (ev) => {
          const e = ev as unknown as { type?: string; tool?: string; meta?: Record<string, unknown> };
          if (e.type === 'tool_progress' && e.meta) {
            send({ ...e.meta, tool: e.tool });
          }
        },
        citationSeq: { current: 0 },
      };
      try {
        send({ phase: 'start', image_key: imageKey, engines: wantClassifier ? ['claude-vision', 'rekognition'] : ['claude-vision'] });
        const tools = kitVisionTools(rctx).map(t => withToolCallRecord(t as never, rctx));
        const compare = tools.find(t => t.name === 'vision_compare_reference');
        const classify = tools.find(t => t.name === 'vision_detect_labels');
        if (!compare) {
          send({ phase: 'done', ok: false, error: 'vision tools are not available' });
          return;
        }
        const reference = JSON.parse(String(await compare.invoke({ image_key: imageKey }))) as Record<string, unknown>;
        if (reference.error) {
          send({ phase: 'done', ok: false, error: String(reference.error), reference });
          return;
        }
        let classifier: Record<string, unknown> | null = null;
        if (wantClassifier && classify) {
          send({ phase: 'classifier', status: 'running' });
          classifier = JSON.parse(String(await classify.invoke({ image_key: imageKey }))) as Record<string, unknown>;
          send({ phase: 'classifier', status: String(classifier.status ?? 'done'), top_label: classifier.top_label ?? null, message: classifier.message ?? null });
        }
        send({ phase: 'done', ok: true, ms: Date.now() - started, reference, classifier });
      } catch (err) {
        send({ phase: 'done', ok: false, error: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
