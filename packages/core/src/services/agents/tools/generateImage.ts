/**
 * generate_image — create an image/graphic from a text prompt and store
 * it as an artifact, returning a served URL. Provider-pluggable
 * (OpenAI gpt-image-1 default) via VOCION_IMAGE_PROVIDER.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { getImageProvider } from '@/libs/tools/image/registry';
import { ProviderNotConfiguredError } from '@/libs/tools/types';

export function generateImageTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { prompt, size } = args;
      try {
        const provider = getImageProvider();
        const { png } = await provider.generate(prompt, { size });
        const artifact = await saveArtifact({
          orgId: ctx.orgId,
          data: png,
          ext: 'png',
          contentType: 'image/png',
        });
        return `Image generated and saved.\nURL: ${artifact.url}\n(${Math.round(artifact.bytes / 1024)} KB, ${provider.name})\n\nReference it in your reply as ![generated image](${artifact.url}).`;
      } catch (err) {
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
