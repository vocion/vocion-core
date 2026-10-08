/**
 * Mixpanel Query API client — the one place that knows how to read a
 * Mixpanel project. Read-only: every call is a GET (or the cohorts list's
 * POST, which reads) against `https://{mixpanel|eu.mixpanel|in.mixpanel}.com/api/query`.
 *
 * Auth is a service account (`username:secret`, HTTP Basic) plus the
 * `project_id` query parameter every call carries — the `mixpanel` platform's
 * two fields and the source's project and region. Built per call with the
 * exact credential in hand, never cached, and no message it produces quotes
 * a secret.
 *
 * Mixpanel's Query API allows 60 queries an hour and 5 at once per project.
 * A 429 is waited out once when Mixpanel says how long (Retry-After, up to
 * `MAX_RETRY_WAIT_MS`), then reported as a sentence.
 *
 * API facts this file depends on (docs.mixpanel.com/reference):
 *   GET  /events/names            → string[] (top events, last 31 days)
 *   GET  /segmentation            → { data: { series: date[], values: { [event]: { [date]: n } } } }
 *                                   unit minute|hour|day|month, type general|unique|average
 *   GET  /funnels/list            → [{ funnel_id, name }]
 *   GET  /funnels                 → { meta: { dates }, data: { [date]: { steps: [{ count, event, … }] } } }
 *   POST /cohorts/list            → [{ id, name, description, count, created, … }]
 */

import { Buffer } from 'node:buffer';

export type MixpanelRegion = 'us' | 'eu' | 'in';

export type MixpanelCredentials = { username: string; secret: string };

export type MixpanelFetch = (url: string, init: RequestInit) => Promise<Response>;

type Sleep = (ms: number) => Promise<void>;

const TIMEOUT_MS = 30_000;
/** The longest Retry-After waited out inside one tool call. */
const MAX_RETRY_WAIT_MS = 10_000;

const HOSTS: Record<MixpanelRegion, string> = {
  us: 'https://mixpanel.com',
  eu: 'https://eu.mixpanel.com',
  in: 'https://in.mixpanel.com',
};

/**
 * The origin a region's project is read from.
 * @param region - The project's data residency.
 */
export function mixpanelHost(region: MixpanelRegion): string {
  return HOSTS[region];
}

/**
 * The project in Mixpanel's own app.
 * @param region - The project's data residency.
 * @param projectId - The project.
 */
export function mixpanelProjectUrl(region: MixpanelRegion, projectId: string): string {
  return `${HOSTS[region]}/project/${encodeURIComponent(projectId)}`;
}

/**
 * The vaulted credential, or why it cannot be used. The field names are the
 * storage contract with the `mixpanel` platform descriptor.
 * @param values - The decrypted credential bag.
 */
export function mixpanelCredentialsFrom(values?: Record<string, unknown> | null): { ok: true; credentials: MixpanelCredentials } | { ok: false; message: string } {
  const username = typeof values?.username === 'string' ? values.username.trim() : '';
  const secret = typeof values?.secret === 'string' ? values.secret.trim() : '';
  if (!username || !secret) {
    return { ok: false, message: 'The Mixpanel credential needs a service account username and its secret.' };
  }
  return { ok: true, credentials: { username, secret } };
}

/** A Mixpanel read that failed, with the sentence to show. */
export class MixpanelError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'MixpanelError';
    this.status = status;
  }
}

/**
 * The sentence for a failed read. Mixpanel's own `error` text is passed on
 * when it sent one (it names a bad event or date, never the secret).
 * @param status - HTTP status.
 * @param vendorMessage - Mixpanel's own `error`, if any.
 */
function failureMessage(status: number, vendorMessage: string | null): string {
  if (status === 401) {
    return 'Mixpanel refused the service account. Check the username and secret are from the same, still-active service account.';
  }
  if (status === 403) {
    return `The Mixpanel service account cannot read this project. Give it a role (Consumer is enough) on the project.${vendorMessage ? ` Mixpanel said: ${vendorMessage}` : ''}`;
  }
  if (status === 404) {
    return 'Mixpanel found no such project in this region. Check the project id and the data residency on the source.';
  }
  if (status === 429) {
    return 'Mixpanel\'s rate limit for this project is spent (60 queries an hour, 5 at once). Try again in a few minutes.';
  }
  return `Mixpanel answered HTTP ${status}${vendorMessage ? `: ${vendorMessage}` : ''}.`;
}

export type MixpanelClient = {
  eventNames: (limit: number) => Promise<string[]>;
  segmentation: (input: { event: string; from: string; to: string; unit: 'day' | 'month'; type: 'general' | 'unique' }) => Promise<Array<{ date: string; value: number }>>;
  funnelsList: () => Promise<Array<{ id: string; name: string }>>;
  funnel: (input: { funnelId: string; from: string; to: string; lengthDays: number }) => Promise<{ steps: Array<{ event: string; count: number }> }>;
  cohorts: () => Promise<Array<{ id: string; name: string; description: string | null; count: number | null; created: string | null }>>;
};

/**
 * A client for one project, with the exact credential in hand.
 * @param input - Where and as whom.
 * @param input.credentials - The service account.
 * @param input.projectId - The project.
 * @param input.region - Its data residency.
 * @param deps - Injected for tests.
 * @param deps.fetch - The network.
 * @param deps.sleep - The wait before a retry.
 */
export function createMixpanelClient(
  input: { credentials: MixpanelCredentials; projectId: string; region: MixpanelRegion },
  deps: { fetch?: MixpanelFetch; sleep?: Sleep } = {},
): MixpanelClient {
  const doFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const auth = `Basic ${Buffer.from(`${input.credentials.username}:${input.credentials.secret}`).toString('base64')}`;
  const base = `${HOSTS[input.region]}/api/query`;

  async function call<T>(path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET'): Promise<T> {
    const url = new URL(`${base}${path}`);
    url.searchParams.set('project_id', input.projectId);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url.toString(), { method, headers: { authorization: auth, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        throw new MixpanelError(`Mixpanel could not be reached (${err instanceof Error ? err.name : 'network error'}).`, null);
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
          const body = await res.json() as { error?: unknown };
          vendor = typeof body.error === 'string' ? body.error.slice(0, 300) : null;
        } catch {}
        throw new MixpanelError(failureMessage(res.status, vendor), res.status);
      }
      return await res.json() as T;
    }
  }

  return {
    async eventNames(limit) {
      const names = await call<unknown>('/events/names', { type: 'general', limit: String(limit) });
      return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [];
    },
    async segmentation({ event, from, to, unit, type }) {
      const body = await call<{ data?: { series?: string[]; values?: Record<string, Record<string, number>> } }>(
        '/segmentation',
        { event, from_date: from, to_date: to, unit, type },
      );
      const values = body.data?.values?.[event] ?? Object.values(body.data?.values ?? {})[0] ?? {};
      const series = body.data?.series ?? Object.keys(values).sort();
      return series.map(date => ({ date: date.slice(0, 10), value: Number(values[date] ?? 0) || 0 }));
    },
    async funnelsList() {
      const rows = await call<Array<{ funnel_id?: unknown; name?: unknown }>>('/funnels/list', {});
      return (Array.isArray(rows) ? rows : []).map(r => ({ id: String(r.funnel_id ?? ''), name: String(r.name ?? '') })).filter(r => r.id !== '');
    },
    async funnel({ funnelId, from, to, lengthDays }) {
      const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
      const body = await call<{ data?: Record<string, { steps?: Array<{ event?: unknown; goal?: unknown; count?: unknown }> }> }>(
        '/funnels',
        { funnel_id: funnelId, from_date: from, to_date: to, length: String(lengthDays), length_unit: 'day', unit: 'day', interval: String(Math.max(1, days)) },
      );
      // One bucket when the interval spans the range; summed across buckets
      // either way, step by step, since each bucket counts the people who
      // started in it.
      const steps: Array<{ event: string; count: number }> = [];
      for (const bucket of Object.values(body.data ?? {})) {
        (bucket.steps ?? []).forEach((step, i) => {
          const count = Number(step.count ?? 0) || 0;
          if (steps[i]) {
            steps[i]!.count += count;
          } else {
            steps[i] = { event: String(step.event ?? step.goal ?? `Step ${i + 1}`), count };
          }
        });
      }
      return { steps };
    },
    async cohorts() {
      const rows = await call<Array<{ id?: unknown; name?: unknown; description?: unknown; count?: unknown; created?: unknown }>>('/cohorts/list', {}, 'POST');
      return (Array.isArray(rows) ? rows : []).map(r => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        description: typeof r.description === 'string' && r.description ? r.description : null,
        count: typeof r.count === 'number' ? r.count : null,
        created: typeof r.created === 'string' && r.created ? r.created : null,
      }));
    },
  };
}
