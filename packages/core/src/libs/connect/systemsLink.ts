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

/**
 * What a link into "Connect your systems" says, in the person's own voice,
 * as the message it sends: the lead reads it like any other ask and decides
 * what to raise (founder, 2026-10-09: "After clicking I got a card
 * immediately. Instead I would expect a chat turn that results in a card").
 * A link never docks the walk by itself; the lead's `connect_system` does.
 * @param names - Display names: the app the link is for, the systems it named.
 * @param names.app - The app's name.
 * @param names.named - The named systems' names.
 */
export function connectSystemsAsk(names: { app?: string | null; named?: readonly string[] }): string {
  const named = (names.named ?? []).filter(Boolean);
  if (named.length > 0) {
    const list = named.length === 1 ? named[0]! : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
    return `Help me connect ${list}`;
  }
  return names.app ? `Help me connect the systems ${names.app} uses` : 'Help me connect the systems this workspace needs';
}
