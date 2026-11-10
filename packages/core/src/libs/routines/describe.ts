/**
 * WHAT AN AUTOMATION DOES, in words: the sites it works on and what it
 * changes, as its expert approved it. Pure and client-safe. Read by the
 * consent judge (`services/agents/consentDecision.ts`), an agent's prompt and
 * the router (`services/routines/savedAutomations.ts`).
 */

import type { RoutineView } from './types';
import { TRUST_LABEL } from './types';

/** The grant that puts the automation tools on an agent's belt (`harness.grantTools: [routines]`). */
export const ROUTINES_GRANT = 'routines';

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/**
 * What an automation changes, as its expert approved it: what is true when a
 * run is done, and the clicks that save — and whether those wait for the
 * expert, by its trust level.
 * @param r - The automation.
 */
export function automationChanges(r: RoutineView): string {
  const spec = r.version?.spec;
  if (!spec) {
    return '';
  }
  const clicks = [...new Set(spec.writes.map(w => w.button))];
  const after = spec.postconditions.slice(0, 3).join('; ');
  const held = r.trust === 'drafted'
    ? 'each of those clicks waits for a person to approve it'
    : 'those clicks run without waiting; any other submit or save still waits for a person';
  return [
    after ? `when a run is done: ${after}` : '',
    clicks.length > 0 ? `it clicks ${clicks.map(c => `"${c}"`).join(', ')} (${TRUST_LABEL[r.trust]} trust: ${held})` : 'it clicks nothing that saves',
  ].filter(Boolean).join('; ');
}

/**
 * The sites an automation works on, by host.
 * @param r - The automation.
 */
export function automationSites(r: RoutineView): string[] {
  const spec = r.version?.spec;
  const hosts = [...(spec?.systems ?? [])];
  const start = spec?.startUrl ? hostOf(spec.startUrl) : null;
  if (start && !hosts.includes(start)) {
    hosts.unshift(start);
  }
  return hosts.filter(Boolean).slice(0, 4);
}
