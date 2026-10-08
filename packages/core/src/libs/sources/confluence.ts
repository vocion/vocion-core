/**
 * Confluence connector — the pages of the Confluence spaces a source lists,
 * as retrievable documents (title, breadcrumb, body as text); and the client
 * the docs family's Confluence provider (`services/docs/providers/confluence.ts`)
 * reads pages and searches with.
 *
 * Auth, two ways, told apart by the credential bag — the same two Jira takes:
 *
 *   - `{ email, apiToken }` — a pasted Atlassian API token, sent as Basic auth
 *     against the site's own `/wiki/rest/api`.
 *   - an Atlassian grant from "Connect with Atlassian" on the same Atlassian
 *     app as Jira (`ATLASSIAN_CLIENT_ID`/`_SECRET`), with the Confluence
 *     scopes (`CONFLUENCE_READ_SCOPES`), sent as a Bearer token against
 *     `api.atlassian.com/ex/confluence/{cloudId}/wiki/rest/api`. The site is
 *     the one whose URL is the source's `baseUrl`. The access token lasts an
 *     hour and is refreshed — and the rotated refresh token saved — through
 *     `usableLoginGrant`, so one caller refreshes at a time.
 *
 * Sync rides CQL (`/content/search`), cursor-paginated: every page in the
 * listed spaces on a full run, and on an incremental one only those with
 * `lastmodified >= now("-Nm")` — relative minutes, so the site's timezone
 * never skews the window, with five minutes of overlap that content-hash
 * dedup absorbs. A page deleted or moved out of the spaces drops at the next
 * full reconcile. Bodies are Confluence storage format (XHTML), flattened to
 * text.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { AtlassianGrant } from '@/libs/atlassian/oauth';
import type { GrantPersistence, LoginGrant } from '@/libs/connect/loginGrant';
import type { VendorResult } from '@/libs/connectors/vendorRequest';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { ATLASSIAN_CONFLUENCE_API_BASE, isAtlassianGrant, refreshAtlassianGrant, siteForBaseUrl } from '@/libs/atlassian/oauth';
import { usableLoginGrant } from '@/libs/connect/loginGrant';
import { basicAuth, htmlToText, vendorRequest } from '@/libs/connectors/vendorRequest';
import { InspectInputError } from './inspect';

export const confluenceConfigSchema = z.object({
  /** Site base URL, e.g. `https://northwind.atlassian.net`. */
  baseUrl: z.string().url(),
  /** Opt-in space include list — only these spaces sync. */
  spaceKeys: z.array(z.string().trim().min(1)).min(1, 'list at least one space key'),
});

const WATERMARK_OVERLAP_MINUTES = 5;
const MAX_PAGES = 200;
const PAGE_SIZE = 50;
const BODY_MAX = 100_000;

export type ConfluencePage = {
  id: string;
  type?: string;
  status?: string;
  title: string;
  space?: { key?: string; name?: string } | null;
  version?: { number?: number; when?: string; by?: { displayName?: string | null } | null } | null;
  body?: { storage?: { value?: string | null } | null } | null;
  ancestors?: Array<{ title?: string | null }> | null;
  _links?: { webui?: string | null } | null;
};

/** Where Confluence calls go for one source, and with which headers. */
export type ConfluenceAuth = { apiBase: string; siteUrl: string; headers: Record<string, string> };

/**
 * Quote a value for CQL.
 * @param value - The value.
 */
export function cqlQuote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`)}"`;
}

/**
 * Resolve how to call Confluence from the credential bag: Basic auth on the
 * site for a pasted token, a Bearer token on api.atlassian.com for a grant
 * (refreshed and saved first when it is expiring, unless `persistence` is
 * `never`, which says so instead).
 * @param input - The site, the bag, and where a refreshed grant is saved.
 * @param input.baseUrl - The source's site URL.
 * @param input.credentials - The decrypted bag.
 * @param input.persistence - Save a refreshed grant (a sync, a tool), or never refresh (Test connection of typed values).
 */
export async function resolveConfluenceAuth(input: { baseUrl: string; credentials: Record<string, unknown> | undefined; persistence: GrantPersistence }): Promise<ConfluenceAuth> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '').replace(/\/wiki$/i, '');
  const { credentials } = input;
  if (isAtlassianGrant(credentials)) {
    const grant = await usableLoginGrant({ vendor: 'Atlassian', provider: 'atlassian', connectorSlug: 'confluence', grant: credentials as unknown as LoginGrant, persistence: input.persistence, refresh: refreshAtlassianGrant }) as unknown as AtlassianGrant;
    const site = siteForBaseUrl(grant, baseUrl);
    if (!site) {
      const reachable = grant.sites.map(s => s.url).join(', ') || 'none';
      throw new Error(`The Atlassian grant does not reach ${baseUrl}. It reaches: ${reachable}. Set the source's site to one of those, or connect with an account that is a member of ${baseUrl}.`);
    }
    return { apiBase: `${ATLASSIAN_CONFLUENCE_API_BASE}/${site.id}/wiki/rest/api`, siteUrl: site.url.replace(/\/+$/, ''), headers: { authorization: `Bearer ${grant.accessToken}` } };
  }
  const email = typeof credentials?.email === 'string' ? credentials.email.trim() : '';
  const apiToken = typeof credentials?.apiToken === 'string' ? credentials.apiToken.trim() : (typeof credentials?.token === 'string' ? credentials.token.trim() : '');
  if (!email || !apiToken) {
    throw new Error('The Confluence connector needs an Atlassian account email and API token, or a Connect with Atlassian login.');
  }
  return { apiBase: `${baseUrl}/wiki/rest/api`, siteUrl: baseUrl, headers: { authorization: basicAuth(email, apiToken) } };
}

/**
 * One call to Confluence's REST API.
 * @param auth - Where and how.
 * @param path - The path, from `/wiki/rest/api`.
 */
export function confluenceApi<T>(auth: ConfluenceAuth, path: string): Promise<VendorResult<T>> {
  return vendorRequest<T>({
    vendor: 'Confluence',
    url: `${auth.apiBase}${path}`,
    headers: auth.headers,
    authHint: 'The API token may be expired or revoked, or the Atlassian login lacks Confluence access: connect Confluence again on the Connectors page.',
  });
}

/**
 * The CQL for one sync run.
 * @param opts - Spaces and the incremental watermark.
 * @param opts.spaceKeys - The spaces.
 * @param opts.since - The watermark, or null for a full run.
 * @param opts.now - Injected for tests.
 */
export function buildConfluenceCql(opts: { spaceKeys: string[]; since?: Date | null; now?: Date }): string {
  const spaces = `space in (${opts.spaceKeys.map(cqlQuote).join(', ')}) and type = page`;
  if (opts.since) {
    const minutes = Math.max(1, Math.ceil(((opts.now ?? new Date()).getTime() - opts.since.getTime()) / 60_000)) + WATERMARK_OVERLAP_MINUTES;
    return `${spaces} and lastmodified >= now("-${minutes}m") order by lastmodified asc`;
  }
  return `${spaces} order by lastmodified asc`;
}

/**
 * The `cursor` of a `_links.next`, which is relative to the site and so not
 * reusable as-is on api.atlassian.com.
 * @param next - The link.
 */
export function cursorOf(next: string | null | undefined): string | null {
  if (!next) {
    return null;
  }
  const query = next.includes('?') ? next.slice(next.indexOf('?') + 1) : '';
  return new URLSearchParams(query).get('cursor');
}

/**
 * A page as text a person can read: its body, flattened.
 * @param page - The page, with `body.storage` expanded.
 */
export function confluencePageText(page: ConfluencePage): string {
  const text = htmlToText(page.body?.storage?.value ?? '');
  return text.length > BODY_MAX ? `${text.slice(0, BODY_MAX)}\n\n[Cut at ${BODY_MAX} characters.]` : text;
}

/**
 * Where a person opens a page.
 * @param auth - The site.
 * @param page - The page.
 */
export function confluencePageUrl(auth: Pick<ConfluenceAuth, 'siteUrl'>, page: ConfluencePage): string {
  return page._links?.webui ? `${auth.siteUrl}/wiki${page._links.webui}` : `${auth.siteUrl}/wiki/pages/viewpage.action?pageId=${page.id}`;
}

/**
 * The searchable document for one page.
 * @param auth - The site, for the link.
 * @param page - The page, with body, version, space and ancestors expanded.
 */
export function confluencePageDoc(auth: ConfluenceAuth, page: ConfluencePage): IngestDoc {
  const breadcrumb = (page.ancestors ?? []).map(a => a.title ?? '').filter(Boolean);
  const space = page.space?.key ?? null;
  return {
    externalId: `confluence:${page.id}`,
    title: page.title,
    content: [page.title, [space ? `Space: ${page.space?.name ?? space}` : null, breadcrumb.length ? `In: ${breadcrumb.join(' › ')}` : null].filter(Boolean).join(' · '), confluencePageText(page)].filter(Boolean).join('\n\n'),
    uri: confluencePageUrl(auth, page),
    lastModifiedAt: page.version?.when ? new Date(page.version.when) : null,
    metadata: { type: 'page', pageId: page.id, spaceKey: space, version: page.version?.number ?? null, updatedBy: page.version?.by?.displayName ?? null, ancestors: breadcrumb },
  };
}

type SearchPage = { results?: ConfluencePage[]; _links?: { next?: string | null } | null };

/**
 * Pages matching a CQL query, with what to expand, one cursor page.
 * @param auth - Where and how.
 * @param cql - The query.
 * @param opts - Page size, cursor and expansions.
 * @param opts.limit - How many.
 * @param opts.cursor - Where to resume.
 * @param opts.expand - What to expand.
 */
export async function confluenceSearch(auth: ConfluenceAuth, cql: string, opts: { limit: number; cursor?: string | null; expand: string }): Promise<VendorResult<SearchPage>> {
  return confluenceApi<SearchPage>(auth, `/content/search?cql=${encodeURIComponent(cql)}&limit=${opts.limit}&expand=${opts.expand}${opts.cursor ? `&cursor=${encodeURIComponent(opts.cursor)}` : ''}`);
}

/**
 * Test connection: the site answered, the credential was accepted, and each
 * space key is readable. A grant is never refreshed here.
 * @param config - The source config.
 * @param values - The credential values.
 */
export async function inspectConfluence(config: Record<string, unknown>, values: Record<string, unknown>): Promise<ConnectorInspection> {
  const parsed = confluenceConfigSchema.safeParse({ baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl.trim() : config.baseUrl, spaceKeys: Array.isArray(config.spaceKeys) ? config.spaceKeys : [] });
  if (!parsed.success) {
    throw new InspectInputError(parsed.error.issues[0]?.message ?? 'A site URL and at least one space key are required.');
  }
  let auth: ConfluenceAuth;
  try {
    auth = await resolveConfluenceAuth({ baseUrl: parsed.data.baseUrl, credentials: values, persistence: { kind: 'never' } });
  } catch (err) {
    throw new InspectInputError((err as Error).message);
  }
  const keys = parsed.data.spaceKeys;
  const spaces = await confluenceApi<{ results?: Array<{ key: string; name: string }> }>(auth, `/space?${keys.map(k => `spaceKey=${encodeURIComponent(k)}`).join('&')}&limit=50`);
  if (!spaces.ok) {
    return { reachable: spaces.kind !== 'unreachable', authorized: false, checks: [{ key: 'site', label: `Reads ${auth.siteUrl}`, ok: false, detail: spaces.message }], note: null, error: spaces.message };
  }
  const found = new Map((spaces.data.results ?? []).map(s => [s.key.toUpperCase(), s.name]));
  const checks: ConnectorCheck[] = [{ key: 'site', label: `Reads ${auth.siteUrl}`, ok: true, detail: null }];
  for (const key of keys) {
    const name = found.get(key.toUpperCase());
    checks.push({ key: `space:${key}`, label: `Space ${key}`, ok: Boolean(name), detail: name ?? 'Not a space this credential can read.' });
  }
  const failed = checks.filter(c => !c.ok);
  return { reachable: true, authorized: true, checks, note: null, error: failed.length > 0 ? failed.map(c => c.detail).join(' ') : null };
}

export const confluenceConnector: SourceConnector<typeof confluenceConfigSchema> = {
  slug: 'confluence',
  brand: 'confluence',
  name: 'Confluence',
  description: 'Pages from Confluence spaces: title, where it sits and the body as text, synced incrementally by last modified. Agents search and read pages live through the docs tools.',
  icon: 'NotebookText',
  authKind: 'apikey',
  configSchema: confluenceConfigSchema,
  defaultReconcileCron: '30 3 * * *',
  inspectNote: 'Reads the site and checks each space key. Nothing is saved, and an Atlassian login is never refreshed here.',

  async inspect({ config, credentials }) {
    return inspectConfluence(config, credentials);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = confluenceConfigSchema.parse(ctx.config);
    const auth = await resolveConfluenceAuth({
      baseUrl: cfg.baseUrl,
      credentials: ctx.credentials,
      persistence: { kind: 'persist', orgId: ctx.orgId, sourceId: ctx.sourceId, warn: message => ctx.onProgress?.({ kind: 'error', message }) },
    });
    const cql = buildConfluenceCql({ spaceKeys: cfg.spaceKeys, since: ctx.since });
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res: VendorResult<SearchPage> = await confluenceSearch(auth, cql, { limit: PAGE_SIZE, cursor, expand: 'body.storage,version,space,ancestors' });
      if (!res.ok) {
        throw new Error(res.message);
      }
      for (const p of res.data.results ?? []) {
        ctx.onProgress?.({ kind: 'fetched', uri: p.id });
        yield confluencePageDoc(auth, p);
      }
      cursor = cursorOf(res.data._links?.next);
      if (!cursor) {
        return;
      }
    }
    ctx.onProgress?.({ kind: 'error', message: `Confluence sync stopped at the ${MAX_PAGES}-page cap; the rest lands on the next run.` });
  },
};
