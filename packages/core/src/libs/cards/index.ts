/**
 * Public entry point for the Cards subsystem. Importing this module
 * (a) registers all first-party Cards as a side effect and (b) re-exports
 * the public surface (resolver, registry, types).
 *
 * Plugin authors don't need to import this — they get types via
 * `@vocion/sdk`. This module is for vocion-core internals that render
 * structured outputs (workflow run-detail, chat, review queue).
 */

import './firstParty';

export { getCard, listCards, registerCard } from './registry';
export { resolveCard, resolveCardAs } from './resolve';
export type {
  AnyCardRenderer,
  CardRenderer,
  CardRendererProps,
  CardResolutionSource,
  CardSurface,
  ResolvedCard,
  ResolveOptions,
} from './types';
export { CARD_SLUG_FIELD } from './types';
