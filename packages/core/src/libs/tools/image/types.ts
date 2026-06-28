import type { Buffer } from 'node:buffer';

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto';

export type GeneratedImage = {
  /** raw PNG bytes */
  png: Buffer;
};

export type ImageProvider = {
  readonly name: string;
  readonly requiredEnv: string[];
  isReady: () => boolean;
  generate: (prompt: string, opts?: { size?: ImageSize }) => Promise<GeneratedImage>;
};

export type ImageProviderName = 'openai';
