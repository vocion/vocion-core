import type { ImageProvider } from './types';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import OpenAI from 'openai';
import { ProviderNotConfiguredError } from '../types';

/**
 * OpenAI image generation (gpt-image-1). Returns base64 PNG which we
 * persist as an artifact. Reuses the OPENAI_API_KEY already required for
 * embeddings, so no new key for the default config.
 */
export function openaiImageProvider(): ImageProvider {
  const requiredEnv = ['OPENAI_API_KEY'];
  const model = process.env.VOCION_IMAGE_MODEL ?? 'gpt-image-1';
  return {
    name: 'openai',
    requiredEnv,
    isReady: () => Boolean(process.env.OPENAI_API_KEY),
    async generate(prompt, opts) {
      const apiKey = process.env.OPENAI_API_KEY;
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
