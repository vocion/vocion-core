/**
 * Internal types for the Cards subsystem. The public API for plugin authors
 * lives in `@vocion/sdk` (packages/sdk/src/cards.ts) — this file re-exports
 * those types for internal consumers and adds the registry-internal shapes
 * (resolution result, source).
 */

import type { AnyCardRenderer, CardSurface } from '@vocion/sdk';

export type { AnyCardRenderer, CardRenderer, CardRendererProps, CardSurface } from '@vocion/sdk';
export { CARD_SLUG_FIELD } from '@vocion/sdk';

/**
 * The mechanism that produced a Card resolution. Tracked so the run-detail /
 * chat surfaces can show provenance (and so we can log Stage 3 A2UI fallback
 * invocations to Langfuse for prioritization).
 */
export type CardResolutionSource
  = | 'deterministic' // payload's __card matched a registered slug
    | 'llm-picked' //    Stage 2 classifier matched (not yet implemented)
    | 'a2ui-generated' // Stage 3 fallback generated a tree (not yet implemented)
    | 'fallback'; //    landed on the JsonDump terminal renderer

/**
 * The result of resolving a card for a payload. Always returns a renderer +
 * the (validated) data + a `source` tag — callers never need to handle "no
 * card found" because `fallback` is always available.
 */
export type ResolvedCard = {
  renderer: AnyCardRenderer;
  data: unknown;
  source: CardResolutionSource;
  /** Slug of the resolved card. Useful for debug overlays + telemetry. */
  slug: string;
  /** When validation failed for a more-specific card and we fell through, why. */
  fallbackReason?: string;
};

/** Options to `resolveCard()`. */
export type ResolveOptions = {
  /** Which surface is requesting the render. Filters out Cards that don't declare it. */
  surface: CardSurface;
};
