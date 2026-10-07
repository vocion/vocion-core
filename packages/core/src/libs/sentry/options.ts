/**
 * What the Sentry SDK is allowed to send — one definition for the browser,
 * the Node server and the edge runtime (`instrumentation-client.ts`,
 * `instrumentation.ts`).
 *
 * A deployment hosting several companies sends every company's errors to one
 * Sentry project, so the defaults are the private ones and each widening is an
 * explicit opt-in:
 *
 * - `NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII=1` — the SDK's own PII (the user's IP
 *   and identity) and unmasked session replays. Off: replays mask every text
 *   node, input and media element.
 * - `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` — the share of requests traced, 0
 *   to 1. Unset or unreadable: 0.1.
 * - `NEXT_PUBLIC_SENTRY_ENABLE_LOGS=1` — console output shipped as Sentry
 *   logs. Off: none, and the console integration is not installed.
 *
 * NEXT_PUBLIC_, like the DSN beside them, so one setting governs both sides;
 * the browser's copy is fixed when the app is built.
 *
 * Scrubbing does not depend on any of them. Every error and transaction leaves
 * with its request stripped of cookies, body, query string and every header
 * outside a short allowlist — sessions, API tokens, invite links and OAuth
 * codes travel in exactly those places, and none of them is PII an operator
 * can opt into.
 *
 * Pure, and free of the SDK, so the browser bundle and the tests can both load
 * it.
 */

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/** Request headers that say what was asked without saying who asked or with what. */
const KEPT_HEADERS = new Set(['accept', 'content-length', 'content-type', 'host', 'user-agent']);

/** The part of a Sentry event's `request` this module touches. */
type EventRequest = {
  url?: string;
  data?: unknown;
  cookies?: unknown;
  query_string?: unknown;
  headers?: Record<string, string>;
};

/** Raw settings, as each runtime reads them from its environment. */
type SentryEnvSettings = {
  sendDefaultPii?: string;
  tracesSampleRate?: string;
  enableLogs?: string;
};

/**
 * `1` or `true`, any case; anything else is off.
 * @param raw - The variable's value.
 */
function isOn(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/**
 * A rate between 0 and 1, or the default for anything else.
 * @param raw - The variable's value.
 */
function sampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : DEFAULT_TRACES_SAMPLE_RATE;
}

/**
 * The event with its request reduced to method, path and the allowlisted
 * headers.
 * @param event - An error or transaction event, as the SDK hands it over.
 */
function scrubRequest<E extends { request?: EventRequest }>(event: E): E {
  const request = event.request;
  if (!request) {
    return event;
  }
  const { data: _data, cookies: _cookies, query_string: _query, headers, url, ...kept } = request;
  const scrubbed: EventRequest = { ...kept };
  if (url !== undefined) {
    scrubbed.url = url.split(/[?#]/, 1)[0];
  }
  if (headers) {
    scrubbed.headers = Object.fromEntries(Object.entries(headers).filter(([name]) => KEPT_HEADERS.has(name.toLowerCase())));
  }
  return { ...event, request: scrubbed } as E;
}

/**
 * The privacy-bearing options: `init` spreads into `Sentry.init` on every
 * runtime, `replayMasking` goes to the browser's `replayIntegration`.
 * @param env - The raw settings this runtime read.
 */
export function sentryOptions(env: SentryEnvSettings) {
  const sendDefaultPii = isOn(env.sendDefaultPii);
  return {
    init: {
      sendDefaultPii,
      tracesSampleRate: sampleRate(env.tracesSampleRate),
      enableLogs: isOn(env.enableLogs),
      beforeSend: scrubRequest,
      beforeSendTransaction: scrubRequest,
    },
    replayMasking: {
      maskAllText: !sendDefaultPii,
      maskAllInputs: !sendDefaultPii,
      blockAllMedia: !sendDefaultPii,
    },
  };
}
