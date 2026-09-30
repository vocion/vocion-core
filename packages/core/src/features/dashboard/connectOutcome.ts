/**
 * What the vendor connect callback wrote into the URL it sent the person to,
 * and the one line they read about it. Pure, so the panel test and the
 * browser both get the same words.
 */

/** How a vendor connect ended, as the callback wrote it into the URL. */
export type ConnectOutcome = { ok: true; source: string | null } | { ok: false; reason: string; source: string | null };

/**
 * Read the callback's outcome off the page URL, or null when there is none.
 * @param search - `window.location.search`.
 */
export function readConnectOutcome(search: string): ConnectOutcome | null {
  const params = new URLSearchParams(search);
  const connect = params.get('connect');
  if (connect !== 'ok' && connect !== 'error') {
    return null;
  }
  const source = params.get('source');
  if (connect === 'ok') {
    return { ok: true, source };
  }
  return { ok: false, reason: params.get('reason') ?? 'unknown', source };
}

/**
 * The one line the person reads after coming back from the vendor. The reason
 * is the callback's short code, never anything the vendor sent.
 * @param outcome - What the URL said.
 */
export function connectOutcomeMessage(outcome: ConnectOutcome): string {
  const which = outcome.source ? ` ${outcome.source}` : '';
  if (outcome.ok) {
    return `Connected${which}. The next sync uses the new credential; Test connection checks it now.`;
  }
  const reasons: Record<string, string> = {
    access_denied: 'You cancelled at the vendor, so nothing was stored.',
    state_expired: 'That authorization link had expired. Start again from Connect.',
    state_bad_signature: 'That authorization link was not one this server issued. Start again from Connect.',
    state_malformed: 'That authorization link was incomplete. Start again from Connect.',
    signed_out: 'You were signed out before the vendor sent you back. Sign in and connect again.',
    wrong_workspace: 'That authorization was started in a different workspace. Switch to it and start again.',
    wrong_person: 'That authorization was started by someone else. Start it yourself from Connect.',
    not_admin: 'Only a workspace admin can finish connecting a source.',
    server_unconfigured: 'This server is missing AUTH_SECRET or NEXT_PUBLIC_APP_URL, so it cannot finish a connect.',
    source_missing: 'The source this authorization was for no longer exists.',
    store_failed: 'The vendor authorized Vocion but the credential could not be stored. Try again; if it repeats, check the server log.',
    not_implemented: 'This provider is not available on this server yet.',
  };
  return `Could not connect${which}: ${reasons[outcome.reason] ?? `the vendor refused (${outcome.reason}).`}`;
}
