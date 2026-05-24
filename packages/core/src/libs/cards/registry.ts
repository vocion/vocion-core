/**
 * Slug-keyed registry of Card renderers. Mirrors the Source connector
 * registry at `libs/sources/registry.ts`.
 *
 * First-party cards register themselves on module load (see `firstParty/`).
 * Plugin-shipped cards register via `PluginManifest.renderers` during plugin
 * load (see `libs/plugins/loader.ts`).
 *
 * Re-registering the same slug overwrites — the last registration wins. This
 * is intentional so a plugin can override a first-party card for its own
 * payloads when slug priority alone wouldn't resolve the collision.
 */

import type { CardRenderer } from '@vocion/sdk';
import type { ZodTypeAny } from 'zod';
import type { AnyCardRenderer, CardSurface } from './types';

const registry = new Map<string, AnyCardRenderer>();

/**
 * Register a Card. Accepts the parameterized `CardRenderer<TSchema>` (the
 * shape `defineCard` returns) and erases to `AnyCardRenderer` for storage.
 * Erasure is the standard variance dance: `ComponentType` is contravariant
 * in its props, so a renderer typed as `data: { foo: string }` isn't
 * directly assignable to a slot expecting `data: any` — the cast moves
 * that boundary into this one function.
 * @param card
 */
export function registerCard<TSchema extends ZodTypeAny>(card: CardRenderer<TSchema>): void {
  registry.set(card.slug, card as unknown as AnyCardRenderer);
}

export function getCard(slug: string): AnyCardRenderer | undefined {
  return registry.get(slug);
}

export function listCards(surface?: CardSurface): AnyCardRenderer[] {
  const all = Array.from(registry.values());
  if (!surface) {
    return all;
  }
  return all.filter(c => c.surfaces.includes(surface));
}

/**
 * Drop a card from the registry. Used by tests; production code should not
 * unregister built-ins.
 * @param slug
 */
export function unregisterCard(slug: string): boolean {
  return registry.delete(slug);
}
