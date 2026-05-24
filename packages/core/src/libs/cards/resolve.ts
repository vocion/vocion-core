/**
 * Card resolution for an arbitrary payload.
 *
 * v0.4 Stage 1 — deterministic only. The full resolution chain (deterministic
 * → LLM-picked → A2UI → JsonDump) ships in v0.5 / v0.6; this implementation
 * is intentionally narrow so it can ship alongside the support-reply demo
 * without scope risk.
 *
 * Always returns a `ResolvedCard` — every payload is renderable. When the
 * payload doesn't carry a `__card` slug or the named card fails to validate
 * the data, we fall through to the built-in `json-dump` renderer.
 */

import type { AnyCardRenderer, ResolvedCard, ResolveOptions } from './types';
import { JSON_DUMP_SLUG } from './firstParty/jsonDump';
import { getCard } from './registry';
import { CARD_SLUG_FIELD } from './types';

const FALLBACK_SLUG = JSON_DUMP_SLUG;

export function resolveCard(payload: unknown, opts: ResolveOptions): ResolvedCard {
  // Try the deterministic path first.
  const determ = resolveDeterministic(payload, opts);
  if (determ) {
    return determ;
  }

  // Stage 2 / Stage 3 hooks slot in here; for now go straight to JsonDump.
  return resolveFallback(payload);
}

function resolveDeterministic(payload: unknown, opts: ResolveOptions): ResolvedCard | null {
  if (!isRecord(payload)) {
    return null;
  }
  const slug = payload[CARD_SLUG_FIELD];
  if (typeof slug !== 'string' || slug.length === 0) {
    return null;
  }
  const card = getCard(slug);
  if (!card) {
    return null;
  }
  if (!card.surfaces.includes(opts.surface)) {
    // Card exists but isn't declared for this surface — treat as a miss so
    // we fall through to JsonDump rather than render in an unsupported host.
    return null;
  }
  // Validate against the card's schema. Strip the `__card` discriminator before
  // parsing so cards don't have to declare it in their own schemas.
  const dataInput = stripCardSlug(payload);
  const parsed = card.dataSchema.safeParse(dataInput);
  if (!parsed.success) {
    // A specific card was named but the payload doesn't match its schema. Fall
    // through to JsonDump with a fallbackReason — surfaces can render this as
    // a soft "we couldn't render this with the requested card" badge.
    return {
      ...resolveFallback(payload),
      fallbackReason: `payload did not match schema for card "${slug}": ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    };
  }
  return {
    renderer: card,
    data: parsed.data,
    source: 'deterministic',
    slug,
  };
}

function resolveFallback(payload: unknown): ResolvedCard {
  const card = getCard(FALLBACK_SLUG);
  if (!card) {
    throw new Error(`Cards registry missing fallback renderer "${FALLBACK_SLUG}". Ensure firstParty/index is imported at boot.`);
  }
  return {
    renderer: card,
    data: payload,
    source: 'fallback',
    slug: FALLBACK_SLUG,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stripCardSlug(payload: Record<string, unknown>): Record<string, unknown> {
  const { [CARD_SLUG_FIELD]: _drop, ...rest } = payload;
  return rest;
}

/* ------------------------------------------------------------------ */
/* Convenience helpers for callers                                     */
/* ------------------------------------------------------------------ */

/**
 * Type-narrowed `resolveCard` when the caller already knows the card slug
 * they expect. Useful when a surface deliberately wants to fail loudly if the
 * payload isn't the expected shape.
 *
 * Returns `null` if the payload doesn't resolve to the named card; never
 * falls back to JsonDump.
 * @param payload
 * @param opts
 * @param expectedSlug
 */
export function resolveCardAs(
  payload: unknown,
  opts: ResolveOptions,
  expectedSlug: string,
): { renderer: AnyCardRenderer; data: unknown } | null {
  const resolved = resolveCard(payload, opts);
  if (resolved.slug !== expectedSlug) {
    return null;
  }
  return { renderer: resolved.renderer, data: resolved.data };
}
