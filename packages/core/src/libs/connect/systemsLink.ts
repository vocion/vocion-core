/**
 * The one link into "Connect your systems": the chat page with the objective
 * named in the query, so every way in — the chat card, the Getting started
 * checklist, an app's page, the Connectors page — opens the same docked
 * walk-through (`features/dashboard/connect-systems`). Pure, so the server
 * (the card) and the client (the chat page) read it the same way.
 */

import type { ConnectPlanInput } from './systemsPlan';

/** The query value that names the objective. */
export const CONNECT_SYSTEMS_OBJECTIVE = 'connect-systems';

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * The chat link that starts the walk-through.
 * @param input - What the person named, or the app the plan is for.
 */
export function connectSystemsHref(input: ConnectPlanInput = {}): string {
  const params = new URLSearchParams({ objective: CONNECT_SYSTEMS_OBJECTIVE });
  if (input.app && SLUG.test(input.app)) {
    params.set('app', input.app);
  }
  const named = (input.named ?? []).filter(s => SLUG.test(s));
  if (named.length > 0) {
    params.set('named', named.join(','));
  }
  return `/dashboard/chat?${params.toString()}`;
}

/**
 * The plan input a link or a query carries, or null when it does not start the
 * objective. Anything that is not a slug is dropped.
 * @param params - The query.
 */
export function connectSystemsInputOf(params: URLSearchParams | Record<string, string | undefined>): ConnectPlanInput | null {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : params[key]) ?? undefined;
  if (get('objective') !== CONNECT_SYSTEMS_OBJECTIVE) {
    return null;
  }
  const app = get('app');
  const named = (get('named') ?? '').split(',').map(s => s.trim()).filter(s => SLUG.test(s));
  return { ...(app && SLUG.test(app) ? { app } : {}), ...(named.length > 0 ? { named } : {}) };
}

/**
 * The plan input a card's link carries.
 * @param href - The card's `href`.
 */
export function connectSystemsInputOfHref(href: string | undefined): ConnectPlanInput | null {
  if (!href) {
    return null;
  }
  const q = href.indexOf('?');
  return q < 0 ? null : connectSystemsInputOf(new URLSearchParams(href.slice(q + 1)));
}
