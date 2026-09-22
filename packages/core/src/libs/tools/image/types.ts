import type { Buffer } from 'node:buffer';

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto';

export type GeneratedImage = {
  /** raw PNG bytes */
  png: Buffer;
  /**
   * The model that produced it, as the provider bills it. Reported so the
   * caller can charge the org's budget at the right rate — `gpt-image-1` costs
   * a multiple of a text completion, and it was the one agent tool that could
   * spend without any cap seeing it (#279).
   */
  model: string;
  /**
   * Tokens the provider billed, when it reported any. `gpt-image-1` prices per
   * token rather than per image, so this is the real cost; a provider that
   * bills per image and reports nothing leaves this undefined and charges
   * nothing until its own pricing lands in `libs/pricing`.
   */
  usage?: { inputTokens?: number; outputTokens?: number };
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
