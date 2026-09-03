import type { ImageProvider } from './types';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import OpenAI from 'openai';
import { resolveOrgProviderKey } from '@/libs/llm/orgKey';
import { ProviderNotConfiguredError } from '../types';

/**
 * OpenAI image generation (gpt-image-1). Returns base64 PNG which we
 * persist as an artifact.
 *
 * Uses the org's own OpenAI key when it has stored one, so image spend lands on
 * the customer's account alongside their model and embedding spend. Falls back
 * to `OPENAI_API_KEY`, which is the same key embeddings already require, so the
 * default config still needs no new secret.
 */
export function openaiImageProvider(): ImageProvider {
  const requiredEnv = ['OPENAI_API_KEY'];
  const model = process.env.VOCION_IMAGE_MODEL ?? 'gpt-image-1';
  return {
    name: 'openai',
    requiredEnv,
    // Reports whether the *server* is configured. An org that supplied its own
    // key can generate images even when this says no, which is why the check
    // below asks again with the org in hand rather than trusting this.
    isReady: () => Boolean(process.env.OPENAI_API_KEY),
    async generate(prompt, opts) {
      const orgKey = opts?.orgId ? await resolveOrgProviderKey('openai', opts.orgId) : null;
      const apiKey = orgKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new ProviderNotConfiguredError('image', 'openai', requiredEnv);
      }
      const client = new OpenAI({ apiKey });
      const res = await client.images.generate({
        model,
        prompt,
        size: opts?.size ?? '1024x1024',
        n: 1,
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) {
        throw new Error('image provider returned no image data');
      }
      return { png: Buffer.from(b64, 'base64') };
    },
  };
}
