import type { ConnectSource } from './types';

/**
 * The event boundary for `connect_source`.
 *
 * Same stance as `recommendedAction.ts`, and for the same reason: a card is a
 * tap away from an action with a side effect — here, an OAuth redirect or a
 * credential write. A payload that cannot name a real connector must never
 * become one, because the failure would land as a broken redirect or a 400
 * from the credentials route rather than as anything the person could act on.
 *
 * Checked once, here, where the event arrives — not in the card and not in the
 * route. Everything downstream can then assume a payload it can render and
 * act on.
 */

export type ConnectSourceCheck
  = | { ok: true; connect: ConnectSource }
    | { ok: false; reason: string };

const STATES = new Set(['connect', 'needs-admin', 'reconnect']);
const SCOPES = new Set(['user', 'workspace']);
const AUTH_KINDS = new Set(['none', 'apikey', 'oauth']);

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validate one `connect_source` payload.
 *
 * Required: a `connectorSlug` (what would be connected) and a `state` (what
 * the person is being offered). `scope` is required too, and is not defaulted:
 * the card's scope line is the sentence that stops somebody wondering whether
 * they just handed the company their mailbox, so guessing it is worse than
 * dropping the card.
 * @param raw - `event.connect`, exactly as it arrived.
 */
export function readConnectSource(raw: unknown): ConnectSourceCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'the connect payload was missing' };
  }
  const r = raw as Record<string, unknown>;
  const connectorSlug = text(r.connectorSlug);
  if (!connectorSlug) {
    return { ok: false, reason: 'the connect card named no connector, so there was nothing to connect' };
  }
  const state = text(r.state);
  if (!STATES.has(state)) {
    return { ok: false, reason: `the connect card for "${connectorSlug}" asked for nothing recognisable` };
  }
  const scope = text(r.scope);
  if (!SCOPES.has(scope)) {
    return { ok: false, reason: `the connect card for "${connectorSlug}" did not say whose connection it would be` };
  }
  const authKind = text(r.authKind);
  const requestedScopes = Array.isArray(r.requestedScopes)
    ? r.requestedScopes.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : [];
  return {
    ok: true,
    connect: {
      connectorSlug,
      name: text(r.name) || connectorSlug,
      icon: text(r.icon) || 'Plug',
      platform: text(r.platform) || null,
      scope: scope as 'user' | 'workspace',
      state: state as 'connect' | 'needs-admin' | 'reconnect',
      authKind: (AUTH_KINDS.has(authKind) ? authKind : 'oauth') as 'none' | 'apikey' | 'oauth',
      reason: text(r.reason),
      requestedScopes,
      tool: text(r.tool),
      intentId: typeof r.intentId === 'number' && Number.isInteger(r.intentId) ? r.intentId : null,
      workspaceGrantAvailable: r.workspaceGrantAvailable === true,
    },
  };
}
