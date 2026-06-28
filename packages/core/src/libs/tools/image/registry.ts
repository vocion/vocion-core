import type { CapabilityStatus } from '../types';
import type { ImageProvider, ImageProviderName } from './types';
import process from 'node:process';
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

export function imageStatus(): CapabilityStatus {
  const name = resolveImageProviderName();
  const provider = getImageProvider(name);
  const ready = provider.isReady();
  return {
    capability: 'generate_image',
    provider: name,
    ready,
    missingEnv: ready ? [] : provider.requiredEnv,
  };
}
