/**
 * Shared HubSpot API client — the one place that knows how to talk to
 * api.hubapi.com. The sync connector, the `hubspot.update` action, and every
 * direct-read agent tool consume it, so auth headers, pagination, and error
 * shaping exist exactly once.
 *
 * Errors are DATA, never throws: a tool hands the failure object straight
 * back to the model, which can then say "the token is missing the
 * sales-email-read scope" instead of eating an opaque exception. Callers that
 * genuinely want a throw (the connector, whose sync contract is
 * throw-on-failure) unwrap and throw themselves.
 */

type Primitive = string | number | boolean | null;

export type HubspotFailure
  = | { ok: false; error: 'no_hubspot_credentials'; message: string }
    | { ok: false; error: 'missing_scope'; scope: string; message: string }
    | { ok: false; error: 'hubspot_error'; status: number; message: string };

export type HubspotResult<T> = { ok: true; data: T } | HubspotFailure;

/**
 * Deal-stage metadata, keyed by stage id.
 *
 * A deal stage is only self-describing in the DEFAULT pipeline (ids like
 * `closedwon`); custom pipelines use opaque numeric ids, so "is this deal
 * open?" is unanswerable from the stage alone.
 */
export type StageInfo = { label: string; isClosed: boolean; pipelineLabel: string; pipelineId: string };

export type HubspotClient = {
  get: <T>(path: string, params?: Record<string, string>) => Promise<HubspotResult<T>>;
  post: <T>(path: string, body: unknown) => Promise<HubspotResult<T>>;
  patch: <T>(path: string, body: unknown) => Promise<HubspotResult<T>>;
  /** Stage labels + closed-ness across EVERY deal pipeline. One request. */
  fetchDealStages: () => Promise<HubspotResult<Map<string, StageInfo>>>;
  baseUrl: string;
};

/**
 * The vaulted private-app token, whichever field name the vault entry used.
 * @param credentials
 */
export function tokenFromCredentials(credentials?: Record<string, unknown>): string | undefined {
  const token = credentials?.token ?? credentials?.accessToken;
  return typeof token === 'string' && token !== '' ? token : undefined;
}

export function noHubspotCredentials(detail?: string): HubspotFailure {
  return {
    ok: false,
    error: 'no_hubspot_credentials',
    message: detail ?? 'No HubSpot credentials are stored in the vault for this workspace. Connect the hubspot source (private-app token) before calling live HubSpot tools.',
  };
}

/**
 * A 403 means the private-app token exists but lacks a scope — name the scope
 * so the fix is actionable. HubSpot's MISSING_SCOPES body lists them under
 * errors[].context.required(Granular)Scopes.
 * @param bodyText
 */
function missingScopeFrom(bodyText: string): { scope: string; detail: string } {
  try {
    const body = JSON.parse(bodyText) as {
      message?: string;
      errors?: Array<{ context?: { requiredGranularScopes?: string[]; requiredScopes?: string[] } }>;
    };
    const scopes = (body.errors ?? [])
      .flatMap(e => e.context?.requiredGranularScopes ?? e.context?.requiredScopes ?? []);
    if (scopes.length > 0) {
      return { scope: scopes.join(', '), detail: body.message ?? '' };
    }
    return { scope: 'unknown', detail: body.message ?? bodyText.slice(0, 300) };
  } catch {
    return { scope: 'unknown', detail: bodyText.slice(0, 300) };
  }
}

async function shapeFailure(res: Response): Promise<HubspotFailure> {
  const text = await res.text().catch(() => '');
  if (res.status === 403) {
    const { scope, detail } = missingScopeFrom(text);
    return {
      ok: false,
      error: 'missing_scope',
      scope,
      message: `HubSpot returned 403: the private-app token is missing the "${scope}" scope. ${detail}`.trim(),
    };
  }
  return {
    ok: false,
    error: 'hubspot_error',
    status: res.status,
    message: `HubSpot API error ${res.status}: ${text.slice(0, 500)}`,
  };
}

export function createHubspotClient(opts: { token: string; baseUrl?: string }): HubspotClient {
  const baseUrl = opts.baseUrl ?? 'https://api.hubapi.com';
  const headers = { 'authorization': `Bearer ${opts.token}`, 'content-type': 'application/json' };

  async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, params?: Record<string, string>, body?: unknown): Promise<HubspotResult<T>> {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}${qs}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      return { ok: false, error: 'hubspot_error', status: 0, message: `HubSpot request failed before a response: ${(err as Error).message}` };
    }
    if (!res.ok) {
      return shapeFailure(res);
    }
    return { ok: true, data: (await res.json()) as T };
  }

  return {
    baseUrl,
    get: (path, params) => request('GET', path, params),
    post: (path, body) => request('POST', path, undefined, body),
    patch: (path, body) => request('PATCH', path, undefined, body),
    async fetchDealStages() {
      type PipelinesBody = {
        results?: Array<{
          id?: string;
          label?: string;
          stages?: Array<{ id?: string; label?: string; metadata?: { isClosed?: string | boolean } }>;
        }>;
      };
      const res = await request<PipelinesBody>('GET', '/crm/v3/pipelines/deals');
      if (!res.ok) {
        return res;
      }
      const map = new Map<string, StageInfo>();
      for (const pipeline of res.data.results ?? []) {
        for (const stage of pipeline.stages ?? []) {
          if (!stage.id) {
            continue;
          }
          const raw = stage.metadata?.isClosed;
          map.set(stage.id, {
            label: stage.label ?? stage.id,
            isClosed: raw === true || raw === 'true',
            pipelineLabel: pipeline.label ?? '',
            pipelineId: pipeline.id ?? '',
          });
        }
      }
      return { ok: true, data: map };
    },
  };
}

/** Standard cursor-paged CRM shapes. */
export type HubspotRecord = {
  id: string;
  properties: Record<string, string | null>;
  updatedAt?: string;
  associations?: Record<string, { results?: Array<{ id?: string | number }> }>;
};
export type HubspotPage = { total?: number; results: HubspotRecord[]; paging?: { next?: { after?: string } } };

/**
 * Parse a HubSpot numeric property, dropping anything that is not a number.
 * @param v
 */
export function hubspotNumeric(v: Primitive | undefined): number | undefined {
  if (v == null || v === '') {
    return undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
