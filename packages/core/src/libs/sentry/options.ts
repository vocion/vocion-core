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
 *   and identity), the caller's address on spans, console breadcrumbs and
 *   unmasked session replays. Off: replays mask every text node, input and
 *   media element.
 * - `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` — the share of requests traced, 0
 *   to 1. Unset or unreadable: 0.1.
 * - `NEXT_PUBLIC_SENTRY_ENABLE_LOGS=1` — console output shipped as Sentry
 *   logs. Off: none, and the console integration is not installed.
 *
 * NEXT_PUBLIC_, like the DSN beside them, so one setting governs both sides;
 * the browser's copy is fixed when the app is built.
 *
 * Scrubbing does not depend on any of them. The SDK copies a URL into many
 * places — the request, Next's `request_path`, the root span's `http.url` and
 * `http.target`, every client and resource span, navigation and fetch
 * breadcrumbs — and every one of them leaves without its query string or
 * fragment. Requests lose their cookies and body, and requests and spans keep
 * only a short header allowlist. Sessions, API tokens, invite links and OAuth
 * codes travel in exactly those places, and none of them is PII an operator
 * can opt into.
 *
 * Pure, and free of the SDK, so the browser bundle and the tests can both load
 * it.
 */

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/** Request headers that say what was asked without saying who asked or with what. */
const KEPT_HEADERS = ['accept', 'content-length', 'content-type', 'host', 'user-agent'];
const KEPT_HEADER_NAMES = new Set(KEPT_HEADERS);

/**
 * Span attributes that copy a header, `http.request.header.<name>` with dashes
 * as underscores (and `.<cookie>` after a cookie header's name).
 */
const HEADER_ATTRIBUTE_PREFIXES = ['http.request.header.', 'http.response.header.'];
const KEPT_HEADER_ATTRIBUTES = new Set(
  HEADER_ATTRIBUTE_PREFIXES.flatMap(prefix => KEPT_HEADERS.map(name => prefix + name.replace(/-/g, '_'))),
);

/** Span and breadcrumb data whose value is a URL: kept, without its query and fragment. */
const URL_KEYS = new Set(['http.url', 'http.target', 'url', 'url.full']);

/** Span and breadcrumb data that is nothing but a query string or fragment: dropped. */
const QUERY_KEYS = new Set(['http.query', 'http.fragment', 'url.query', 'url.fragment']);

/** A caller's or peer's network address: dropped unless PII is opted into. */
const ADDRESS_KEYS = new Set(['http.client_ip', 'client.address', 'net.peer.ip', 'net.sock.peer.addr', 'network.peer.address']);

/** The part of a Sentry event's `request` this module touches. */
type EventRequest = {
  url?: string;
  data?: unknown;
  cookies?: unknown;
  query_string?: unknown;
  headers?: Record<string, string>;
};

/** A span as an event carries it: its data, and for some ops a URL as its description. */
type EventSpan = { op?: string; description?: string; data?: Record<string, unknown> };

/** The part of a breadcrumb this module touches. */
type EventBreadcrumb = { category?: string; data?: Record<string, unknown> };

/** The parts of an error or transaction event this module touches. */
type ScrubbableEvent = {
  request?: EventRequest;
  contexts?: Record<string, unknown>;
  spans?: EventSpan[];
  breadcrumbs?: EventBreadcrumb[];
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
 * A URL, or a path, or `GET <url>`, without its query string and fragment.
 * @param url - As the SDK recorded it.
 */
function stripQuery(url: string): string {
  return url.split(/[?#]/, 1)[0]!;
}

/**
 * Plain-object check for the loosely typed corners of an event.
 * @param value - Anything.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Span or breadcrumb data with every URL stripped of its query, query-only and
 * non-allowlisted header attributes dropped, and addresses dropped unless PII
 * is opted into.
 * @param data - The span's or breadcrumb's data.
 * @param keepAddresses - Whether PII is opted into.
 */
function scrubData(data: Record<string, unknown>, keepAddresses: boolean): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (QUERY_KEYS.has(key) || (!keepAddresses && ADDRESS_KEYS.has(key))) {
      continue;
    }
    if (HEADER_ATTRIBUTE_PREFIXES.some(prefix => key.startsWith(prefix)) && !KEPT_HEADER_ATTRIBUTES.has(key)) {
      continue;
    }
    kept[key] = URL_KEYS.has(key) && typeof value === 'string' ? stripQuery(value) : value;
  }
  return kept;
}

/**
 * The request reduced to method, path and the allowlisted headers.
 * @param request - The event's request.
 */
function scrubRequest(request: EventRequest): EventRequest {
  const { data: _data, cookies: _cookies, query_string: _query, headers, url, ...kept } = request;
  const scrubbed: EventRequest = { ...kept };
  if (url !== undefined) {
    scrubbed.url = stripQuery(url);
  }
  if (headers) {
    scrubbed.headers = Object.fromEntries(Object.entries(headers).filter(([name]) => KEPT_HEADER_NAMES.has(name.toLowerCase())));
  }
  return scrubbed;
}

/**
 * Next's `request_path` (set by `captureRequestError`, query included) and the
 * root span's data under `trace`.
 * @param contexts - The event's contexts.
 * @param keepAddresses - Whether PII is opted into.
 */
function scrubContexts(contexts: Record<string, unknown>, keepAddresses: boolean): Record<string, unknown> {
  const scrubbed = { ...contexts };
  const nextjs = asRecord(contexts.nextjs);
  if (nextjs && typeof nextjs.request_path === 'string') {
    scrubbed.nextjs = { ...nextjs, request_path: stripQuery(nextjs.request_path) };
  }
  const trace = asRecord(contexts.trace);
  const traceData = asRecord(trace?.data);
  if (trace && traceData) {
    scrubbed.trace = { ...trace, data: scrubData(traceData, keepAddresses) };
  }
  return scrubbed;
}

/**
 * A child span. An http or resource span's description is its URL — a
 * resource span's keeps the query, which for a presigned image is a signature.
 * @param span - As the transaction carries it.
 * @param keepAddresses - Whether PII is opted into.
 */
function scrubSpan<S extends EventSpan>(span: S, keepAddresses: boolean): S {
  const describesUrl = typeof span.op === 'string' && (span.op.startsWith('http.') || span.op.startsWith('resource.'));
  return {
    ...span,
    ...(span.data ? { data: scrubData(span.data, keepAddresses) } : {}),
    ...(describesUrl && typeof span.description === 'string' ? { description: stripQuery(span.description) } : {}),
  };
}

/**
 * A breadcrumb, or null to drop it. A console breadcrumb's message is the
 * logged arguments joined, so it goes whole unless PII is opted into;
 * navigation keeps where it went from and to, without the query.
 * @param breadcrumb - As the SDK recorded it.
 * @param keepPii - Whether PII is opted into.
 */
function scrubBreadcrumb<B extends EventBreadcrumb>(breadcrumb: B, keepPii: boolean): B | null {
  if (breadcrumb.category === 'console' && !keepPii) {
    return null;
  }
  if (!breadcrumb.data) {
    return breadcrumb;
  }
  const data = scrubData(breadcrumb.data, keepPii);
  if (breadcrumb.category === 'navigation') {
    for (const key of ['from', 'to']) {
      if (typeof data[key] === 'string') {
        data[key] = stripQuery(data[key]);
      }
    }
  }
  return { ...breadcrumb, data };
}

/**
 * An error or transaction event with every place the SDK copies a request
 * scrubbed. Breadcrumbs are scrubbed here as well as in `beforeBreadcrumb`,
 * because one added straight to a scope never passes through that hook.
 * @param event - As the SDK hands it over.
 * @param keepPii - Whether PII is opted into.
 */
function scrubEvent<E extends ScrubbableEvent>(event: E, keepPii: boolean): E {
  const scrubbed: ScrubbableEvent = { ...event };
  if (event.request) {
    scrubbed.request = scrubRequest(event.request);
  }
  if (event.contexts) {
    scrubbed.contexts = scrubContexts(event.contexts, keepPii);
  }
  if (event.spans) {
    scrubbed.spans = event.spans.map(span => scrubSpan(span, keepPii));
  }
  if (event.breadcrumbs) {
    scrubbed.breadcrumbs = event.breadcrumbs
      .map(breadcrumb => scrubBreadcrumb(breadcrumb, keepPii))
      .filter(breadcrumb => breadcrumb !== null);
  }
  return scrubbed as E;
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
      beforeSend: <E extends ScrubbableEvent>(event: E): E => scrubEvent(event, sendDefaultPii),
      beforeSendTransaction: <E extends ScrubbableEvent>(event: E): E => scrubEvent(event, sendDefaultPii),
      beforeBreadcrumb: <B extends EventBreadcrumb>(breadcrumb: B): B | null => scrubBreadcrumb(breadcrumb, sendDefaultPii),
    },
    replayMasking: {
      maskAllText: !sendDefaultPii,
      maskAllInputs: !sendDefaultPii,
      blockAllMedia: !sendDefaultPii,
    },
  };
}
