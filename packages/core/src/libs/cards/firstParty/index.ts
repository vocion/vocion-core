/**
 * First-party Card registry side-effects. Importing this module registers
 * all built-in Cards. Order matters only insofar as collisions overwrite:
 * later registrations win.
 *
 * Boot order: `libs/cards/firstParty/index.ts` is imported by the app's
 * server boot (see `app/[locale]/(auth)/dashboard/workflows/[slug]/runs/[runId]/page.tsx`
 * — every page that calls `resolveCard()` needs the cards registered).
 */

import { registerCard } from '../registry';
import { jsonDumpCard } from './jsonDump';
import { keyValueCard } from './keyValue';
import { sendStubCard } from './sendStub';

let registered = false;

/**
 * Idempotently register all first-party Cards. Called from server-side
 * boot. Safe to call multiple times.
 */
export function registerFirstPartyCards(): void {
  if (registered) {
    return;
  }
  registerCard(jsonDumpCard);
  registerCard(keyValueCard);
  registerCard(sendStubCard);
  registered = true;
}

// Eager registration so simply importing `firstParty` is sufficient. Modules
// that need a deterministic boot order can call `registerFirstPartyCards()`
// explicitly.
registerFirstPartyCards();

export { JSON_DUMP_SLUG, jsonDumpCard } from './jsonDump';
export { KEY_VALUE_SLUG, keyValueCard } from './keyValue';
export { SEND_STUB_SLUG, sendStubCard } from './sendStub';
