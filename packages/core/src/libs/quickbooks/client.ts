/**
 * Reading a QuickBooks Online company: the query endpoint, paged, read-only;
 * and the one way anything is written back (`quickbooksWrite`), used only by
 * approved finance actions.
 *
 * One reader shape, two backings. `liveQuickbooksReader` calls Intuit with a
 * login's access token; `sampleQuickbooksReader` (`sampleCompany.ts`) answers
 * the same queries from a fictional company held in memory, so the connector,
 * an agent and a demo all work before anyone has an Intuit app or a company
 * to connect. The connector cannot tell them apart, which is the point: the
 * sample exercises every line of the mapping the real books go through.
 *
 * Failures throw `QuickbooksQueryError` carrying a sentence a person acts on
 * (log in again, wait for the rate limit, ask Intuit) and no token.
 */

/** API hosts, per Intuit environment. A sandbox company is only on the sandbox host. */
export const QUICKBOOKS_API_BASE = {
  production: 'https://quickbooks.api.intuit.com',
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
} as const;

/** Where a person opens a transaction in QuickBooks, per environment. */
export const QUICKBOOKS_APP_HOST = {
  production: 'https://app.qbo.intuit.com',
  sandbox: 'https://app.sandbox.qbo.intuit.com',
} as const;

/** The API minor version every request names; Intuit retired the ones before it. */
export const QUICKBOOKS_MINOR_VERSION = '75';

/** The most rows one query page returns: Intuit's own ceiling. */
export const QUICKBOOKS_PAGE_SIZE = 1000;

const REQUEST_TIMEOUT_MS = 30_000;

/** The QuickBooks entities the connector reads, by their API names. */
export type QuickbooksEntity = 'Account' | 'Invoice' | 'Bill' | 'Payment' | 'BillPayment' | 'Purchase' | 'JournalEntry';

/** A row as the API returns it. Read defensively: every field may be missing. */
export type QuickbooksRow = Record<string, unknown>;

/** One company's books, readable a page at a time. */
export type QuickbooksReader = {
  /** The company id (realm), or `sample`. */
  realmId: string;
  /** True for the fictional sample company. */
  sample: boolean;
  /** Where a transaction opens in QuickBooks, or null when it cannot (the sample). */
  appHost: string | null;
  /**
   * One page of an entity, oldest id first.
   * @param entity - What to read.
   * @param page - Where to start (1-based, as Intuit counts), how many, and the incremental watermark.
   */
  query: (entity: QuickbooksEntity, page: { start: number; max: number; since?: Date | null }) => Promise<QuickbooksRow[]>;
};

/** A query that failed, with the sentence for the person and whether retrying the run could help. */
export class QuickbooksQueryError extends Error {
  readonly status: number | null;
  /** True when every other query would fail the same way (a refused login), so the run should stop. */
  readonly fatal: boolean;

  constructor(message: string, status: number | null, fatal: boolean) {
    super(message);
    this.name = 'QuickbooksQueryError';
    this.status = status;
    this.fatal = fatal;
  }
}

/**
 * The query for one page: every column of the entity, changed since the
 * watermark when there is one. Built only from the entity name and dates this
 * module controls, never from input.
 * @param entity - What to read.
 * @param page - Where to start, how many, and the watermark.
 * @param page.start - 1-based start position.
 * @param page.max - Page size.
 * @param page.since - Incremental watermark.
 */
export function quickbooksQuery(entity: QuickbooksEntity, page: { start: number; max: number; since?: Date | null }): string {
  const where = page.since ? ` WHERE Metadata.LastUpdatedTime >= '${page.since.toISOString()}'` : '';
  return `SELECT * FROM ${entity}${where} STARTPOSITION ${page.start} MAXRESULTS ${page.max}`;
}

/**
 * Intuit's own error message out of a fault body, when there is one. Short,
 * and never the request.
 * @param body - The parsed error body.
 */
function faultMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  // Intuit spells it `Fault.Error[]` on the accounting API and `fault.error[]` on its gateway.
  const outer = body as { Fault?: { Error?: unknown }; fault?: { error?: unknown } };
  const errors = outer.Fault?.Error ?? outer.fault?.error;
  const first = Array.isArray(errors) && errors[0] && typeof errors[0] === 'object' ? errors[0] as Record<string, unknown> : null;
  const text = first?.Message ?? first?.message;
  return typeof text === 'string' && text.trim() ? text.trim().slice(0, 200) : null;
}

/**
 * The error for a non-2xx answer, worded for the fix.
 * @param entity - What was being read.
 * @param status - The HTTP status.
 * @param body - The parsed body, if it parsed.
 */
function queryFailure(entity: QuickbooksEntity, status: number, body: unknown): QuickbooksQueryError {
  const detail = faultMessage(body);
  const said = detail ? ` QuickBooks said: ${detail}` : '';
  if (status === 401) {
    return new QuickbooksQueryError(`QuickBooks refused the login (401). An admin needs to log in with QuickBooks again on the Connectors page.${said}`, status, true);
  }
  if (status === 403) {
    return new QuickbooksQueryError(`QuickBooks would not let this login read ${entity} records (403): the QuickBooks user who logged in may lack access to them, or the company's subscription may not include them.${said}`, status, false);
  }
  if (status === 429) {
    return new QuickbooksQueryError(`QuickBooks is rate-limiting this company (429). The next sync picks up where this one stopped.${said}`, status, true);
  }
  if (status >= 500) {
    return new QuickbooksQueryError(`QuickBooks failed on its side reading ${entity} records (${status}). Try again later.${said}`, status, false);
  }
  return new QuickbooksQueryError(`QuickBooks rejected the ${entity} query (${status}).${said}`, status, false);
}

/**
 * One write to a company: a create, a sparse update or a delete of one
 * entity, as `POST /v3/company/<realm>/<entity>`. Never retried: a write
 * QuickBooks may have taken is not sent twice. A failure carries Intuit's own
 * reason (a stale SyncToken, a closed period) and no token.
 * @param input - The write.
 * @param input.base - The API host for the company's environment.
 * @param input.realmId - The company id.
 * @param input.accessToken - The login's current access token.
 * @param input.entity - The entity, by its API name.
 * @param input.body - The entity's JSON.
 * @param input.operation - `delete` to delete; a create or an update otherwise.
 * @param input.fetch - The network; the global one when left out.
 * @returns The entity as QuickBooks answered it.
 */
export async function quickbooksWrite(input: {
  base: string;
  realmId: string;
  accessToken: string;
  entity: QuickbooksEntity;
  body: QuickbooksRow;
  operation?: 'delete';
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<QuickbooksRow> {
  const params = new URLSearchParams({ minorversion: QUICKBOOKS_MINOR_VERSION, ...(input.operation ? { operation: input.operation } : {}) });
  const url = `${input.base.replace(/\/+$/, '')}/v3/company/${encodeURIComponent(input.realmId)}/${input.entity.toLowerCase()}?${params.toString()}`;
  const doFetch = input.fetch ?? ((u: string, init?: RequestInit) => fetch(u, init));
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'authorization': `Bearer ${input.accessToken}` },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new QuickbooksQueryError(`QuickBooks could not be reached to write the ${input.entity}. Check QuickBooks before trying again: the change may or may not have been made.`, null, false);
  }
  let body: unknown = null;
  try {
    body = JSON.parse(await response.text());
  } catch {
    // Not JSON: the status says what happened.
  }
  if (!response.ok) {
    throw writeFailure(input.entity, response.status, body);
  }
  const row = (body as Record<string, unknown> | null)?.[input.entity];
  return row && typeof row === 'object' ? row as QuickbooksRow : {};
}

/**
 * The error for a refused write, worded for the fix.
 * @param entity - What was being written.
 * @param status - The HTTP status.
 * @param body - The parsed body, if it parsed.
 */
function writeFailure(entity: QuickbooksEntity, status: number, body: unknown): QuickbooksQueryError {
  const detail = faultDetail(body);
  const said = detail ? ` QuickBooks said: ${detail}` : '';
  if (status === 401) {
    return new QuickbooksQueryError(`QuickBooks refused the login (401). An admin needs to log in with QuickBooks again on the Connectors page.${said}`, status, true);
  }
  if (status === 403) {
    return new QuickbooksQueryError(`QuickBooks would not let this login change ${entity} records (403): the QuickBooks user who logged in may lack that access.${said}`, status, false);
  }
  if (status === 429) {
    return new QuickbooksQueryError(`QuickBooks is rate-limiting this company (429); nothing was written. Try again in a minute.${said}`, status, true);
  }
  if (status >= 500) {
    return new QuickbooksQueryError(`QuickBooks failed on its side writing the ${entity} (${status}). Check QuickBooks before trying again.${said}`, status, false);
  }
  return new QuickbooksQueryError(`QuickBooks refused the ${entity} change (${status}); nothing was written.${said}`, status, false);
}

/**
 * Intuit's message and its detail out of a fault body: on a write the detail
 * is the useful half ("Stale Object Error : You and … were working on this").
 * @param body - The parsed error body.
 */
function faultDetail(body: unknown): string | null {
  const message = faultMessage(body);
  const outer = body as { Fault?: { Error?: unknown } } | null;
  const first = Array.isArray(outer?.Fault?.Error) ? outer.Fault.Error[0] as Record<string, unknown> | undefined : undefined;
  const detail = typeof first?.Detail === 'string' && first.Detail.trim() ? first.Detail.trim().slice(0, 300) : null;
  return detail && detail !== message ? detail : message;
}

/**
 * The environment an API base belongs to, for the links back into QuickBooks.
 * @param baseUrl - The API base in use.
 */
function environmentOf(baseUrl: string): 'production' | 'sandbox' {
  return baseUrl.includes('sandbox') ? 'sandbox' : 'production';
}

/**
 * A reader over a real company, with a login's access token. A new reader
 * per sync, so a token is never shared between companies or orgs.
 * @param input - The company and how to reach it.
 * @param input.accessToken - The login's current access token.
 * @param input.realmId - The company id.
 * @param input.baseUrl - The API host for the company's environment.
 */
export function liveQuickbooksReader(input: { accessToken: string; realmId: string; baseUrl: string }): QuickbooksReader {
  const base = input.baseUrl.replace(/\/+$/, '');
  return {
    realmId: input.realmId,
    sample: false,
    appHost: QUICKBOOKS_APP_HOST[environmentOf(base)],
    async query(entity, page) {
      const params = new URLSearchParams({ query: quickbooksQuery(entity, page), minorversion: QUICKBOOKS_MINOR_VERSION });
      let response: Response;
      try {
        response = await fetch(`${base}/v3/company/${encodeURIComponent(input.realmId)}/query?${params.toString()}`, {
          headers: { accept: 'application/json', authorization: `Bearer ${input.accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        throw new QuickbooksQueryError(timedOut ? `QuickBooks did not answer the ${entity} query within ${REQUEST_TIMEOUT_MS / 1000}s. Try again later.` : 'QuickBooks could not be reached. Try again later.', null, true);
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Not JSON: the status says what happened.
      }
      if (!response.ok) {
        throw queryFailure(entity, response.status, body);
      }
      const rows = (body as { QueryResponse?: Record<string, unknown> } | null)?.QueryResponse?.[entity];
      return Array.isArray(rows) ? rows.filter((row): row is QuickbooksRow => Boolean(row) && typeof row === 'object') : [];
    },
  };
}
