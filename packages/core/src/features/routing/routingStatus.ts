/** The Routing section's words (ADR 0006): pure, so they test without the page. */
import type { JevKeyStatus } from '@/services/routing/jevKey';

/**
 * The line saying whether routing is on. Pure.
 * @param keys - The key status, or null when it could not be read.
 */
export function routingStatusLine(keys: Pick<JevKeyStatus, 'effective'> & { hint?: string | null } | null): string {
  if (!keys?.effective) {
    return 'Dynamic routing is off: no Jev (TypeSafe) API key is set, so every turn runs its configured model. Set one in System or Developers → Dynamic routing.';
  }
  return `Dynamic routing is on, on the ${keys.effective === 'workspace' ? 'workspace' : 'instance'} key${keys.hint ? ` (${keys.hint})` : ''}.`;
}

/**
 * A share as a percentage, or a dash.
 * @param part - The part.
 * @param whole - The whole.
 */
export function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}
