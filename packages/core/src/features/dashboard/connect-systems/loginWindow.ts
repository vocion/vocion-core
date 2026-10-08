/**
 * A login (or a connector's full form) in a window of its own, so the
 * walk-through never leaves the conversation.
 *
 * The window runs the ordinary connect flow — the start route, the vendor,
 * the callback — and lands on `/dashboard/connect/done`, which posts the
 * outcome back here and closes itself. As a second way to hear it, this side
 * also watches the window's address once it is back on our origin, so a
 * landing page that could not post still ends the wait. A window the person
 * closes ends it too, as `closed`.
 */

/** The message `/dashboard/connect/done` posts to the window that opened it. */
export const CONNECT_DONE_MESSAGE = 'vocion:connect-done';

export type LoginOutcome
  = | { ok: true }
    | { ok: false; reason: string };

/**
 * The outcome a landing URL carries (`?connect=ok|error&reason=`), or null when
 * it is not a connect landing yet.
 * @param search - The landing's query string.
 */
export function outcomeOfSearch(search: string): LoginOutcome | null {
  const params = new URLSearchParams(search);
  const connect = params.get('connect');
  if (connect === 'ok') {
    return { ok: true };
  }
  if (connect === 'error') {
    return { ok: false, reason: params.get('reason') ?? 'unknown' };
  }
  return null;
}

/** Reasons the walk-through words for a person, by the short code the callback lands with. */
const REASONS: Record<string, string> = {
  access_denied: 'The login was declined at the vendor.',
  missing_access: 'The login did not grant the access it needs. Try again and leave every box ticked.',
  not_admin: 'Only a workspace admin can connect a system.',
  closed: 'The login window was closed before it finished.',
  blocked: 'Your browser blocked the login window. Allow pop-ups for this site, then press Connect again.',
  provider_unreachable: 'The vendor did not answer. Try again in a moment.',
};

/**
 * A reason code in words.
 * @param code - The short code.
 */
export function reasonInWords(code: string): string {
  return REASONS[code] ?? `The login did not finish (${code.replace(/[^\w.-]/g, '_').slice(0, 40)}).`;
}

/**
 * Open the window and resolve with how it ended.
 * @param href - The start route (or a full form's page).
 * @param opts - How it is watched.
 * @param opts.closesAsOk - A full form has no landing: its window closing is the end, and verification says whether it worked.
 * @param opts.pollMs - How often the window is checked.
 */
export function openLoginWindow(href: string, opts: { closesAsOk?: boolean; pollMs?: number } = {}): Promise<LoginOutcome> {
  const width = 560;
  const height = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open(href, 'vocion-connect', `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  if (!popup) {
    return Promise.resolve({ ok: false, reason: 'blocked' });
  }
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let onMessage: (e: MessageEvent) => void = () => {};
    const finish = (outcome: LoginOutcome) => {
      if (done) {
        return;
      }
      done = true;
      clearInterval(timer);
      window.removeEventListener('message', onMessage);
      try {
        popup.close();
      } catch {}
      resolve(outcome);
    };
    onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== popup) {
        return;
      }
      const data = e.data as { type?: string; search?: string } | null;
      if (data?.type === CONNECT_DONE_MESSAGE) {
        finish(outcomeOfSearch(data.search ?? '') ?? { ok: true });
      }
    };
    window.addEventListener('message', onMessage);
    timer = setInterval(() => {
      if (popup.closed) {
        finish(opts.closesAsOk ? { ok: true } : { ok: false, reason: 'closed' });
        return;
      }
      try {
        // Readable only once the window is back on our origin.
        if (popup.location.origin === window.location.origin) {
          const outcome = outcomeOfSearch(popup.location.search);
          if (outcome) {
            finish(outcome);
          }
        }
      } catch {
        // At the vendor: cross-origin, keep waiting.
      }
    }, opts.pollMs ?? 400);
  });
}
