/**
 * Amplitude Dashboard REST API client — the one place that knows how to read
 * an Amplitude project. Read-only: every call is a GET against
 * `https://amplitude.com` (US) or `https://analytics.eu.amplitude.com` (EU).
 *
 * Auth is the project's API key and secret key as HTTP Basic — the
 * `amplitude` platform's two fields. Built per call with the exact key pair
 * in hand, never cached, and no message it produces quotes a secret.
 *
 * Every endpoint has a concurrent limit and an hourly cost limit per
 * project; exceeding either answers 429. A 429 is waited out once when
 * Amplitude says how long (Retry-After, up to `MAX_RETRY_WAIT_MS`), then
 * reported as a sentence.
 *
 * API facts this file depends on (amplitude.com/docs/apis/analytics):
 *   GET /api/2/events/list          → { data: [{ value, display, totals, hidden, deleted, non_active }] }
 *   GET /api/2/events/segmentation  e={"event_type":…}, m=totals|uniques, i=1|7|30, start/end YYYYMMDD
 *                                   → { data: { series: [[n…]], xValues: [YYYY-MM-DD…] } }
 *   GET /api/2/funnels              e=… per step, mode=ordered, cs=<seconds>, start/end
 *                                   → { data: [{ events, cumulativeRaw: [n…], … }] }
 *   GET /api/3/cohorts              → { cohorts: [{ id, name, description, size, lastComputed, lastMod, archived, hidden }] }
 */

import { Buffer } from 'node:buffer';

export type AmplitudeRegion = 'us' | 'eu';

export type AmplitudeCredentials = { apiKey: string; secretKey: string };

export type AmplitudeFetch = (url: string, init: RequestInit) => Promise<Response>;

type Sleep = (ms: number) => Promise<void>;

const TIMEOUT_MS = 30_000;
/** The longest Retry-After waited out inside one tool call. */
const MAX_RETRY_WAIT_MS = 10_000;

const HOSTS: Record<AmplitudeRegion, string> = {
  us: 'https://amplitude.com',
  eu: 'https://analytics.eu.amplitude.com',
};

/**
 * The origin a region's project is read from.
 * @param region - The project's data residency.
 */
export function amplitudeHost(region: AmplitudeRegion): string {
  return HOSTS[region];
}

/**
 * The vaulted credential, or why it cannot be used. The field names are the
 * storage contract with the `amplitude` platform descriptor.
 * @param values - The decrypted credential bag.
 */
export function amplitudeCredentialsFrom(values?: Record<string, unknown> | null): { ok: true; credentials: AmplitudeCredentials } | { ok: false; message: string } {
  const apiKey = typeof values?.apiKey === 'string' ? values.apiKey.trim() : '';
  const secretKey = typeof values?.secretKey === 'string' ? values.secretKey.trim() : '';
  if (!apiKey || !secretKey) {
    return { ok: false, message: 'The Amplitude credential needs the project\'s API key and secret key.' };
  }
  return { ok: true, credentials: { apiKey, secretKey } };
}

/** An Amplitude read that failed, with the sentence to show. */
export class AmplitudeError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'AmplitudeError';
    this.status = status;
  }
}

function failureMessage(status: number, vendorMessage: string | null): string {
  if (status === 401 || status === 403) {
    return 'Amplitude refused the key pair. Check the API key and secret key are from the same project, and the data residency (US or EU) on the source.';
  }
  if (status === 429) {
    return 'Amplitude\'s rate limit for this project is spent. Try again in a few minutes, or ask for fewer events at once.';
  }
  return `Amplitude answered HTTP ${status}${vendorMessage ? `: ${vendorMessage}` : ''}.`;
}

/**
 * YYYY-MM-DD → YYYYMMDD, the date shape the Dashboard REST API takes.
 * @param day - YYYY-MM-DD.
 */
function compact(day: string): string {
  return day.replaceAll('-', '');
}

export type AmplitudeClient = {
  eventsList: () => Promise<Array<{ name: string; totals: number | null }>>;
  segmentation: (input: { event: string; from: string; to: string; interval: 1 | 7 | 30; metric: 'totals' | 'uniques' }) => Promise<Array<{ date: string; value: number }>>;
  funnel: (input: { steps: string[]; from: string; to: string; windowSeconds: number }) => Promise<{ steps: Array<{ event: string; count: number }> }>;
  cohorts: () => Promise<Array<{ id: string; name: string; description: string | null; size: number | null; updated: string | null }>>;
};

/**
 * An ISO time from Amplitude's timestamps, which arrive as epoch seconds,
 * epoch milliseconds or date strings depending on the field.
 * @param value - The raw value.
 */
function isoOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === 'string' && value) {
    const at = Date.parse(value);
    return Number.isNaN(at) ? null : new Date(at).toISOString();
  }
  return null;
}

/**
 * A client for one project, with the exact key pair in hand.
 * @param input - Where and as whom.
 * @param input.credentials - The key pair.
 * @param input.region - The project's data residency.
 * @param deps - Injected for tests.
 * @param deps.fetch - The network.
 * @param deps.sleep - The wait before a retry.
 */
export function createAmplitudeClient(
  input: { credentials: AmplitudeCredentials; region: AmplitudeRegion },
  deps: { fetch?: AmplitudeFetch; sleep?: Sleep } = {},
): AmplitudeClient {
  const doFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const auth = `Basic ${Buffer.from(`${input.credentials.apiKey}:${input.credentials.secretKey}`).toString('base64')}`;

  async function get<T>(path: string, params: Array<[string, string]>): Promise<T> {
    const url = new URL(`${HOSTS[input.region]}${path}`);
    for (const [k, v] of params) {
      url.searchParams.append(k, v);
    }
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url.toString(), { method: 'GET', headers: { authorization: auth, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        throw new AmplitudeError(`Amplitude could not be reached (${err instanceof Error ? err.name : 'network error'}).`, null);
      }
      if (res.status === 429 && attempt === 0) {
        const wait = Number(res.headers.get('retry-after')) * 1000;
        if (Number.isFinite(wait) && wait > 0 && wait <= MAX_RETRY_WAIT_MS) {
          await sleep(wait);
          continue;
        }
      }
      if (!res.ok) {
        let vendor: string | null = null;
        try {
          vendor = (await res.text()).slice(0, 300) || null;
        } catch {}
        throw new AmplitudeError(failureMessage(res.status, vendor), res.status);
      }
      return await res.json() as T;
    }
  }

  return {
    async eventsList() {
      const body = await get<{ data?: Array<{ value?: unknown; display?: unknown; totals?: unknown; hidden?: unknown; deleted?: unknown }> }>('/api/2/events/list', []);
      return (body.data ?? [])
        .filter(e => e.deleted !== true && e.hidden !== true && typeof e.value === 'string' && e.value)
        .map(e => ({ name: String(e.value), totals: typeof e.totals === 'number' ? e.totals : null }));
    },
    async segmentation({ event, from, to, interval, metric }) {
      const body = await get<{ data?: { series?: number[][]; xValues?: string[] } }>('/api/2/events/segmentation', [
        ['e', JSON.stringify({ event_type: event })],
        ['m', metric],
        ['i', String(interval)],
        ['start', compact(from)],
        ['end', compact(to)],
      ]);
      const xs = body.data?.xValues ?? [];
      const values = body.data?.series?.[0] ?? [];
      return xs.map((date, i) => ({ date: date.slice(0, 10), value: Number(values[i] ?? 0) || 0 }));
    },
    async funnel({ steps, from, to, windowSeconds }) {
      const body = await get<{ data?: Array<{ events?: unknown[]; cumulativeRaw?: unknown[] }> }>('/api/2/funnels', [
        ...steps.map(step => ['e', JSON.stringify({ event_type: step })] as [string, string]),
        ['mode', 'ordered'],
        ['n', 'active'],
        ['cs', String(windowSeconds)],
        ['start', compact(from)],
        ['end', compact(to)],
      ]);
      const group = body.data?.[0];
      const counts = group?.cumulativeRaw ?? [];
      return { steps: steps.map((step, i) => ({ event: step, count: Number(counts[i] ?? 0) || 0 })) };
    },
    async cohorts() {
      const body = await get<{ cohorts?: Array<{ id?: unknown; name?: unknown; description?: unknown; size?: unknown; lastComputed?: unknown; lastMod?: unknown; archived?: unknown; hidden?: unknown }> }>('/api/3/cohorts', []);
      return (body.cohorts ?? [])
        .filter(c => c.archived !== true && c.hidden !== true)
        .map(c => ({
          id: String(c.id ?? ''),
          name: String(c.name ?? ''),
          description: typeof c.description === 'string' && c.description ? c.description : null,
          size: typeof c.size === 'number' ? c.size : null,
          updated: isoOf(c.lastComputed) ?? isoOf(c.lastMod),
        }));
    },
  };
}
