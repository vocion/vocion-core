import type { ChartImage } from '@/libs/charts/raster';
import type { ChartSpec } from '@/libs/charts/spec';
import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';
import { rasterizeChart } from '@/libs/charts/raster';

/**
 * PICTURES IN TOOL RESULTS (Chris, 2026-10-24: chart quality is the model's
 * judgement, so the model should see what it drew).
 *
 * A tool may hand the model an image beside its text, as content blocks, only
 * where the model API takes images in a tool result. Anthropic's does; the
 * chat-completions tool message (OpenAI) takes text only, and the AgentCore
 * container and the out-of-process tool endpoint build their own context
 * without the capability, so they keep the text-only receipt.
 *
 * The capability is read off the model the turn runs on, once, at compile
 * time (`harness.ts`), and carried on the context as `toolResultImages`.
 */

/** LangChain chat-model types whose API accepts an image inside a tool result. */
const IMAGE_TOOL_RESULT_MODELS = new Set(['anthropic']);

/**
 * Whether this chat model can be handed an image in a tool result.
 * @param model - The turn's chat model (anything with `_llmType`).
 */
export function takesToolResultImages(model: unknown): boolean {
  const type = (model as { _llmType?: () => string } | null | undefined)?._llmType?.();
  return typeof type === 'string' && IMAGE_TOOL_RESULT_MODELS.has(type);
}

export type ToolResultBlock = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/**
 * A tool result with a picture: the text first (what every reader of the
 * result stores), then the image.
 * @param text - The receipt.
 * @param image - The picture, or null for the text alone.
 */
export function withImage(text: string, image: ChartImage | null): string | ToolResultBlock[] {
  if (!image) {
    return text;
  }
  return [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }];
}

/**
 * The picture of a chart for its review, when this turn's model takes one.
 * @param ctx - The turn's capability.
 * @param ctx.toolResultImages - Set at compile time.
 * @param spec - The chart.
 */
export async function chartReviewImage(ctx: { toolResultImages?: boolean }, spec: ChartSpec): Promise<ChartImage | null> {
  return ctx.toolResultImages ? rasterizeChart(spec) : null;
}

const OMITTED = '[The chart image was shown once, right after it was drawn, and is left out of later steps.]';

function kindOf(m: unknown): string | undefined {
  const msg = m as { type?: unknown; _getType?: () => string } | null | undefined;
  return typeof msg?.type === 'string' ? msg.type : msg?._getType?.();
}

function hasImage(content: unknown): boolean {
  return Array.isArray(content) && content.some(b => (b as { type?: string })?.type === 'image_url' || (b as { type?: string })?.type === 'image');
}

/**
 * The messages with every tool-result image the model has already answered
 * replaced by a line of text: a picture is seen once, by the model call right
 * after the tool that made it, and not paid for again on every later step.
 * @param messages - The turn's messages, oldest first.
 */
export function dropSeenImages<M>(messages: M[]): M[] {
  // The trailing tool results are the ones the model has not answered yet.
  let lastAi = -1;
  messages.forEach((m, i) => {
    if (kindOf(m) === 'ai') {
      lastAi = i;
    }
  });
  let changed = false;
  const out = messages.map((m, i) => {
    if (i > lastAi || kindOf(m) !== 'tool' || !hasImage((m as ToolMessage).content)) {
      return m;
    }
    changed = true;
    const tm = m as ToolMessage;
    const kept = (tm.content as Array<{ type?: string }>).filter(b => b.type !== 'image_url' && b.type !== 'image');
    return new ToolMessage({ content: [...kept, { type: 'text', text: OMITTED }] as never, tool_call_id: tm.tool_call_id, name: tm.name, status: tm.status }) as M;
  });
  return changed ? out : messages;
}

/** Every model call of the turn sees a tool-result image at most once. */
export function createSeenImagesMiddleware() {
  return createMiddleware({
    name: 'VocionToolImagesOnce',
    wrapModelCall: async (request, handler) => {
      const messages = dropSeenImages(request.messages as unknown[]);
      return handler(messages === (request.messages as unknown[]) ? request : { ...request, messages: messages as never });
    },
  });
}
