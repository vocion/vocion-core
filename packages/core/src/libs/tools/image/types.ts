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
  /**
   * Generate one image.
   *
   * `orgId` is what lets a provider spend the org's own vendor key rather than
   * the server's. It is optional because not every caller has an org in hand —
   * a provider with no org falls back to the server's key.
   */
  generate: (prompt: string, opts?: { size?: ImageSize; orgId?: string }) => Promise<GeneratedImage>;
};

export type ImageProviderName = 'openai';
