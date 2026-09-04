import type { CapabilityStatus } from '../types';
import type { ImageProvider, ImageProviderName } from './types';
import process from 'node:process';
import { statusForProvider } from '../status';
import { openaiImageProvider } from './openai';

export function resolveImageProviderName(): ImageProviderName {
  // Only openai today; adapter-ready for others.
  const raw = (process.env.VOCION_IMAGE_PROVIDER ?? 'openai').toLowerCase();
  return raw === 'openai' ? 'openai' : 'openai';
}

export function getImageProvider(name = resolveImageProviderName()): ImageProvider {
  switch (name) {
    case 'openai':
    default:
      return openaiImageProvider();
  }
}

export async function imageStatus(orgId?: string): Promise<CapabilityStatus> {
  const name = resolveImageProviderName();
  return statusForProvider('generate_image', getImageProvider(name), orgId);
}
