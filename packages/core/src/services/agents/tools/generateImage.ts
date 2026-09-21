/**
 * generate_image — create an image/graphic from a text prompt and store
 * it as an artifact, returning a served URL. Provider-pluggable
 * (OpenAI gpt-image-1 default) via VOCION_IMAGE_PROVIDER.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { FEATURES } from '@/libs/Langfuse/features';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { getImageProvider } from '@/libs/tools/image/registry';
import { ProviderNotConfiguredError, ToolProviderKeyUnavailableError } from '@/libs/tools/types';

export function generateImageTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { prompt, size } = args;
      try {
        // One of two paid calls a hard cap is allowed to refuse, and the reason
        // is the price: an image costs a multiple of a text completion, and an
        // agent loop can mint them one after another. Refusing returns a
        // sentence the agent can act on rather than throwing, so the turn
        // continues without the picture instead of failing outright.
        // Imported here rather than at the top of the file: `BudgetService`
        // reaches the database handle, which validates the whole environment at
        // import, and the tool registry is loaded by tests that configure none.
        const { chargeUsage, preflightCheck } = await import('@/services/BudgetService');
        const budget = await preflightCheck({
          orgId: ctx.orgId,
          agentSlug: ctx.agentSlug,
          feature: FEATURES.TOOL_IMAGE,
        });
        if (!budget.ok) {
          return `Image generation was refused: this workspace is over its ${budget.reason === 'hard_cents_exceeded' ? 'spend' : 'token'} cap for "${budget.agentSlug}" (${budget.current}/${budget.limit}). An admin can raise it under Budgets, or it resets next period.`;
        }
        const provider = getImageProvider();
        const { png, model, usage } = await provider.generate(prompt, { size, orgId: ctx.orgId });
        if (usage) {
          await chargeUsage({
            orgId: ctx.orgId,
            agentSlug: ctx.agentSlug,
            feature: FEATURES.TOOL_IMAGE,
            model,
            usage,
          });
        }
        const artifact = await saveArtifact({
          orgId: ctx.orgId,
          data: png,
          ext: 'png',
          contentType: 'image/png',
        });
        return `Image generated and saved.\nURL: ${artifact.url}\n(${Math.round(artifact.bytes / 1024)} KB, ${provider.name})\n\nReference it in your reply as ![generated image](${artifact.url}).`;
      } catch (err) {
        if (err instanceof ToolProviderKeyUnavailableError) {
          // Same reasoning as web_search and fetch_url: this workspace may hold
          // a working key we could not open, so falling through to the
          // deployment's would bill the wrong party, and the vault's own words
          // do not belong in a tool result.
          return `${err.message}. A workspace admin can re-enter it under API credentials.`;
        }
        if (err instanceof ProviderNotConfiguredError) {
          return `Image generation is not configured (${err.message}).`;
        }
        return `Image generation failed: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'generate_image',
      description:
        'Generate an image/graphic from a text prompt (e.g. social or ad creative, a simple illustration). Returns a URL to the saved image. Be specific about subject, style, and composition.',
      schema: z.object({
        prompt: z.string().min(1).describe('Detailed description of the image to generate'),
        size: z.enum(['1024x1024', '1536x1024', '1024x1536', 'auto']).optional().describe('Image dimensions (default 1024x1024)'),
      }),
    },
  );
}
