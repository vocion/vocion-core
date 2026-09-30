/**
 * Jira connector — ingest projects and issues from a Jira Cloud site as
 * retrievable documents (key, summary, status, description).
 *
 * Auth, two ways, told apart by the credential bag:
 *
 *   - `{ email, apiToken }` — a pasted Atlassian API token, sent as Basic auth
 *     against the site's own URL. Tokens created since Dec 2024 carry a
 *     mandatory expiry (1–365 days), so a 401/403 surfaces as an actionable
 *     "reconnect" error rather than a retry loop.
 *   - `{ accessToken, refreshToken, expiresAt, sites, cloudId? }` — an OAuth
 *     2.0 (3LO) grant from "Connect with Atlassian" (`libs/atlassian/oauth.ts`),
 *     sent as a Bearer token against `api.atlassian.com/ex/jira/{cloudId}`.
 *     The grant may reach several sites; the one whose URL is the source's
 *     `baseUrl` is used, and a grant that reaches none of them fails naming
 *     the sites it does reach. The access token lasts an hour: it is refreshed
 *     before it expires (or once, on a 401), and because Atlassian ROTATES the
 *     refresh token, what comes back is persisted at once through
 *     `updateCredentialValuesForConnector`. Test connection never refreshes —
 *     it has nowhere to persist the rotated token — and says so instead.
 *
 * Incremental (`ctx.since` set): only issues with `updated >=` the watermark,
 * expressed as relative JQL minutes (`updated >= "-Nm"`) so the site's
 * timezone never skews the window; a 5-minute overlap covers JQL's
 * minute-granularity timestamps, and content-hash dedup downstream makes the
 * re-yields free. Full sync (`ctx.since` null — backfill and the reconcile
 * schedule): every non-done issue plus done issues updated inside
 * `doneWindowDays`, so long-dead tickets age out via the full-sync tombstone.
 *
 * Search rides `POST /rest/api/3/search/jql` — the current endpoint; the
 * classic `/rest/api/3/search` was removed in 2025 — paginating by
 * `nextPageToken` with an explicit field list (the new endpoint returns no
 * fields unless asked). Issues are keyed by the immutable numeric id, never
 * the issue key: moving an issue between projects renames the key.
 *
 * Statuses: "completed" means `statusCategory.key === 'done'` — the fixed
 * three-value platform enum every custom status maps to — minus any names
 * listed in `notDoneStatuses` (admins often park "Won't Do" / "Duplicate"
 * in the done category).
 */

import type { ConnectorCheck, ConnectorInspection, InspectInput } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { AtlassianGrant } from '@/libs/atlassian/oauth';
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { ATLASSIAN_API_BASE, isAtlassianGrant, isExpiring, refreshAtlassianGrant, siteForBaseUrl } from '@/libs/atlassian/oauth';
import { fetchRetryingRateLimits } from '@/libs/http/retryAfter';
import { getCredentialsForSource, updateCredentialValuesForConnector } from '@/services/SourceCredentialService';
import { InspectInputError } from './inspect';

const jiraConfigSchema = z.object({
  /** Site base URL, e.g. `https://acme.atlassian.net`. */
  baseUrl: z.string().url(),
  /** Opt-in project include list — only these projects sync. */
  projectKeys: z.array(z.string().min(1)).min(1),
  /** Full-sync scope for done issues: keep ones updated within this window. */
  doneWindowDays: z.number().int().positive().default(90),
  /** Include the issue description in the embedded content. */
  includeDescription: z.boolean().default(true),
  /** Status names in Jira's done category to treat as NOT completed (e.g. "Won't Do"). */
  notDoneStatuses: z.array(z.string()).default([]),
});

/** How many `nextPageToken` pages one sync may walk before bailing out. */
const MAX_PAGES = 200;
const PAGE_SIZE = 100;
const MAX_RETRIES = 5;
/** JQL timestamps are minute-granular — overlap the watermark to never miss same-minute edits. */
const WATERMARK_OVERLAP_MINUTES = 5;

type JiraProject = { id: string; key: string; name: string; description?: string };
type JiraProjectPage = { values: JiraProject[]; isLast?: boolean; startAt: number; maxResults: number };
type AdfNode = { type?: string; text?: string; content?: AdfNode[] };
type JiraIssue = {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: AdfNode | null;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    assignee?: { displayName?: string; emailAddress?: string } | null;
    created?: string;
    updated?: string;
  };
};
type JiraSearchPage = { issues?: JiraIssue[]; nextPageToken?: string; isLast?: boolean };

/**
 * Quote a value for JQL, escaping backslashes and double quotes.
 * @param value
 */
function jqlQuote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`)}"`;
}

/**
 * Flatten an Atlassian Document Format tree to plain text. Text nodes
 * concatenate within a block; block-level nodes join with newlines.
 * @param node - ADF root (the `description` field) or any subtree.
 */
export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) {
    return '';
  }
  if (node.type === 'text') {
    return node.text ?? '';
  }
  const children = (node.content ?? []).map(child => adfToText(child));
  // Containers whose children are blocks (paragraphs, list items, rows)
  // separate them with newlines; a block's own children are inline text
  // and concatenate as written.
  const blockContainers = new Set(['doc', 'blockquote', 'listItem', 'bulletList', 'orderedList', 'table', 'tableRow', 'panel', 'mediaGroup', 'expand']);
  const joiner = blockContainers.has(node.type ?? '') ? '\n' : '';
  return children.join(joiner).replaceAll(/\n{3,}/g, '\n\n').trim();
}

/**
 * The JQL for one sync run.
 *
 * Incremental: relative minutes back from now (timezone-proof, minute-granular
 * with overlap). Full: all non-done issues, plus done ones updated within the
 * window, plus any `notDoneStatuses` regardless of age (they're done-category
 * but semantically still open).
 * @param opts - Project scope + window config and the incremental watermark.
 * @param opts.projectKeys
 * @param opts.since
 * @param opts.doneWindowDays
 * @param opts.notDoneStatuses
 * @param opts.now
 */
export function buildJql(opts: {
  projectKeys: string[];
  since?: Date | null;
  doneWindowDays: number;
  notDoneStatuses: string[];
  now?: Date;
}): string {
  const projects = `project in (${opts.projectKeys.map(jqlQuote).join(', ')})`;
  if (opts.since) {
    const elapsedMs = (opts.now ?? new Date()).getTime() - opts.since.getTime();
    const minutes = Math.max(1, Math.ceil(elapsedMs / 60_000)) + WATERMARK_OVERLAP_MINUTES;
    return `${projects} AND updated >= "-${minutes}m" ORDER BY updated ASC`;
  }
  const notDone = opts.notDoneStatuses.length > 0
    ? ` OR status in (${opts.notDoneStatuses.map(jqlQuote).join(', ')})`
    : '';
  return `${projects} AND (statusCategory != Done OR updated >= "-${opts.doneWindowDays}d"${notDone}) ORDER BY updated ASC`;
}

/**
 * How one sync (or one inspection) talks to Jira: the API base, the site the
 * documents link to, the headers for the current token, and — for a grant —
 * the refresh that keeps the token alive.
 */
type JiraAuth = {
  /** Where the REST calls go: the site itself, or api.atlassian.com for a grant. */
  apiBase: string;
  /** The site's own URL, for `/browse/` links on every document. */
  siteUrl: string;
  headers: () => Record<string, string>;
  /** Refresh if the token is about to expire. No-op for Basic auth. */
  ensureFresh: () => Promise<void>;
  /** A request answered 401. True when it should be retried once with a fresh token. */
  onUnauthorized: () => Promise<boolean>;
  /** What a person should do about a 401/403 on this path. */
  reconnectHint: string;
};

/**
 * What the OAuth path does with a rotated token. The sync persists it; an
 * inspection cannot (it has no org to write under), so it refuses to refresh.
 */
type GrantPersistence
  = | { kind: 'persist'; orgId: string; warn: (message: string) => void }
    | { kind: 'never' };

/**
 * Resolve how to authenticate from the credential bag.
 * @param input - Config, credentials and what to do with a rotated token.
 * @param input.baseUrl - The source's site URL, already trimmed of its trailing slash.
 * @param input.credentials - The decrypted bag.
 * @param input.persistence - Where a rotated refresh token goes.
 */
export function resolveJiraAuth(input: {
  baseUrl: string;
  credentials: Record<string, unknown> | undefined;
  persistence: GrantPersistence;
}): JiraAuth {
  const { baseUrl, credentials } = input;
  if (isAtlassianGrant(credentials)) {
    return grantAuth(baseUrl, credentials, input.persistence);
  }
  const email = credentials?.email as string | undefined;
  const apiToken = (credentials?.apiToken ?? credentials?.token) as string | undefined;
  if (!email || !apiToken) {
    throw new Error('Jira connector requires credentials.email and credentials.apiToken (an Atlassian API token), or an Atlassian grant from Connect with Atlassian.');
  }
  const authorization = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
  return {
    apiBase: baseUrl,
    siteUrl: baseUrl,
    headers: () => ({ authorization, 'accept': 'application/json', 'content-type': 'application/json' }),
    ensureFresh: async () => {},
    onUnauthorized: async () => false,
    reconnectHint: 'The API token may be expired or revoked — reconnect the Jira source with a fresh token from id.atlassian.com.',
  };
}

const RECONNECT_HINT = 'The Atlassian grant may have been revoked — open the source and Connect with Atlassian again.';

/**
 * The grant as currently stored for the org's Jira install, or null when the
 * stored bag is not a grant (or there is none).
 * @param orgId - The org whose install to read.
 */
async function readStoredGrant(orgId: string): Promise<AtlassianGrant | null> {
  const stored = await getCredentialsForSource(orgId, 'jira').catch(() => undefined);
  return isAtlassianGrant(stored) ? stored : null;
}

function grantAuth(baseUrl: string, grant: AtlassianGrant, persistence: GrantPersistence): JiraAuth {
  const site = siteForBaseUrl(grant, baseUrl);
  if (!site) {
    const reachable = grant.sites.map(s => s.url).join(', ') || 'none';
    throw new Error(
      `The Atlassian grant does not reach ${baseUrl}. It reaches: ${reachable}. Set the source's baseUrl to one of those, or reconnect with an account that is a member of ${baseUrl}.`,
    );
  }
  let current: AtlassianGrant = { ...grant, cloudId: site.id };
  let refreshedOnce = false;

  const refresh = async (): Promise<void> => {
    if (persistence.kind === 'never') {
      throw new Error(
        'The Atlassian access token has expired and Test connection does not refresh it: a refresh rotates the stored refresh token, and the test has nowhere to save the new one. Run Sync now, which refreshes and saves it, then test again.',
      );
    }
    // The install is shared by every Jira source in the org, and a person may
    // reconnect while this sync runs. So refresh from what is STORED now, not
    // from what this run loaded at its start: another sync may already have
    // rotated it, and Atlassian retires a refresh token the moment its
    // successor is minted (with a ten-minute reuse window as the safety net).
    const stored = await readStoredGrant(persistence.orgId);
    const parent = stored?.refreshToken ?? current.refreshToken;
    let fresh: Awaited<ReturnType<typeof refreshAtlassianGrant>>;
    try {
      fresh = await refreshAtlassianGrant(parent);
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)} ${RECONNECT_HINT}`);
    }
    current = { ...current, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, expiresAt: fresh.expiresAt, ...(fresh.scope ? { scope: fresh.scope } : {}) };
    refreshedOnce = true;
    // Compare-and-swap on the parent token: a concurrent sync or a fresh
    // consent that landed first wins, and this run adopts what it stored.
    let saved = false;
    try {
      saved = await updateCredentialValuesForConnector({ orgId: persistence.orgId, connectorSlug: 'jira', raw: current, expectedRefreshToken: parent });
      if (!saved) {
        const winner = await readStoredGrant(persistence.orgId);
        if (winner && winner.refreshToken !== parent) {
          current = { ...winner, cloudId: site.id };
          return;
        }
      }
    } catch (err) {
      // A vault or database failure must not end a sync that holds a working
      // token. Reported without the error text, which can carry row contents.
      console.warn('[jira] could not persist the rotated Atlassian refresh token', { orgId: persistence.orgId, error: err instanceof Error ? err.name : 'unknown' });
    }
    if (!saved) {
      // The run continues on the fresh token; the NEXT run will not.
      persistence.warn('Atlassian rotated the refresh token but the stored credential could not be updated (the grant may be stored as a workspace credential). Reconnect with Atlassian before the next sync.');
    }
  };

  return {
    apiBase: `${ATLASSIAN_API_BASE}/${site.id}`,
    siteUrl: site.url.replace(/\/$/, ''),
    headers: () => ({ 'authorization': `Bearer ${current.accessToken}`, 'accept': 'application/json', 'content-type': 'application/json' }),
    ensureFresh: async () => {
      if (isExpiring(current.expiresAt)) {
        await refresh();
      }
    },
    onUnauthorized: async () => {
      if (refreshedOnce) {
        return false;
      }
      await refresh();
      return true;
    },
    reconnectHint: RECONNECT_HINT,
  };
}

/**
 * Fetch with Jira-appropriate failure handling: exact `Retry-After` on 429
 * (retrying early extends the penalty, so the shared helper honours the wait
 * Jira asked for); one retry on 401 when the auth path can mint a fresh
 * token; and an actionable error on 401/403 otherwise — the admin must
 * reconnect, no amount of retrying helps.
 * @param auth - How to authenticate.
 * @param path - Path under the API base, starting with `/rest/`.
 * @param init - Method and body; headers come from `auth`.
 */
async function jiraFetch(auth: JiraAuth, path: string, init: RequestInit = {}): Promise<Response> {
  await auth.ensureFresh();
  let res = await fetchRetryingRateLimits(`${auth.apiBase}${path}`, { ...init, headers: auth.headers() }, { maxRetries: MAX_RETRIES });
  if (res.status === 401 && await auth.onUnauthorized()) {
    res = await fetchRetryingRateLimits(`${auth.apiBase}${path}`, { ...init, headers: auth.headers() }, { maxRetries: MAX_RETRIES });
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Jira rejected the credentials (${res.status}). ${auth.reconnectHint}`);
  }
  if (!res.ok) {
    throw new Error(`Jira request failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res;
}

function issueToDoc(baseUrl: string, issue: JiraIssue, includeDescription: boolean, notDoneStatuses: string[]): IngestDoc {
  const f = issue.fields ?? {};
  const status = f.status?.name ?? 'Unknown';
  const statusCategory = f.status?.statusCategory?.key ?? 'new';
  const description = includeDescription ? adfToText(f.description) : '';
  const content = [`${issue.key} — ${f.summary ?? ''}`.trim(), `Status: ${status}`, description]
    .filter(Boolean)
    .join('\n');
  return {
    // The numeric id is immutable; the key changes when an issue moves projects.
    externalId: `jira:${issue.id}`,
    title: `[${issue.key}] ${f.summary ?? ''}`.trim(),
    content,
    uri: `${baseUrl}/browse/${issue.key}`,
    lastModifiedAt: f.updated ? new Date(f.updated) : null,
    metadata: {
      type: 'issue',
      key: issue.key,
      jiraId: issue.id,
      projectKey: issue.key.split('-')[0],
      issueType: f.issuetype?.name,
      status,
      statusCategory,
      completed: statusCategory === 'done' && !notDoneStatuses.includes(status),
      assignee: f.assignee?.emailAddress ?? f.assignee?.displayName ?? null,
      created: f.created,
      updated: f.updated,
    },
  };
}

/**
 * What Test connection reports: the site answered, the credential was
 * accepted, and each project key is reachable.
 * @param auth - How to authenticate.
 * @param projectKeys - The keys the source opts in to.
 */
export async function inspectJira(auth: JiraAuth, projectKeys: string[]): Promise<ConnectorInspection> {
  const checks: ConnectorCheck[] = [];
  let reachable = false;
  let authorized = false;
  try {
    const res = await jiraFetch(auth, '/rest/api/3/project/search?maxResults=50');
    reachable = true;
    authorized = true;
    const body = (await res.json()) as JiraProjectPage;
    const found = new Map((body.values ?? []).map(p => [p.key, p]));
    for (const key of projectKeys) {
      const project = found.get(key);
      checks.push({
        key: `project:${key}`,
        label: `Project ${key}`,
        ok: project !== undefined,
        detail: project ? project.name : `Not among the first 50 projects this credential can see on ${auth.siteUrl}.`,
      });
    }
    return { reachable, authorized, checks, note: `Site ${auth.siteUrl}.`, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const rejected = /rejected the credentials|access token has expired/.test(message);
    return {
      reachable: reachable || rejected,
      authorized: false,
      checks,
      note: null,
      error: message,
    };
  }
}

export const jiraConnector: SourceConnector<typeof jiraConfigSchema> = {
  slug: 'jira',
  name: 'Jira',
  description: 'Ingest Jira projects and issues (key, summary, status, description) — incremental by updated date.',
  icon: 'SquareKanban',
  authKind: 'apikey',
  configSchema: jiraConfigSchema,
  defaultReconcileCron: '0 3 * * *',
  inspectNote: 'Reads the site and checks each project key is reachable. Nothing is saved, and an Atlassian grant is never refreshed here.',
  async inspect({ config, credentials }: InspectInput): Promise<ConnectorInspection> {
    const parsed = jiraConfigSchema.pick({ baseUrl: true, projectKeys: true }).safeParse({
      baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl.trim() : config.baseUrl,
      projectKeys: Array.isArray(config.projectKeys) ? config.projectKeys : [],
    });
    if (!parsed.success) {
      throw new InspectInputError(parsed.error.issues[0]?.message ?? 'A site URL and at least one project key are required.');
    }
    let auth: JiraAuth;
    try {
      auth = resolveJiraAuth({ baseUrl: parsed.data.baseUrl.replace(/\/$/, ''), credentials, persistence: { kind: 'never' } });
    } catch (err) {
      throw new InspectInputError(err instanceof Error ? err.message : String(err));
    }
    return inspectJira(auth, parsed.data.projectKeys);
  },
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = jiraConfigSchema.parse(ctx.config);
    const auth = resolveJiraAuth({
      baseUrl: cfg.baseUrl.replace(/\/$/, ''),
      credentials: ctx.credentials,
      persistence: { kind: 'persist', orgId: ctx.orgId, warn: message => ctx.onProgress?.({ kind: 'error', message }) },
    });
    const baseUrl = auth.siteUrl;

    // Projects first — one document each, cheap enough to refresh every run.
    const wanted = new Set(cfg.projectKeys);
    let startAt = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await jiraFetch(auth, `/rest/api/3/project/search?startAt=${startAt}&maxResults=50`);
      const body = (await res.json()) as JiraProjectPage;
      for (const p of body.values ?? []) {
        if (!wanted.has(p.key)) {
          continue;
        }
        ctx.onProgress?.({ kind: 'fetched', uri: p.key });
        yield {
          externalId: `jira-project:${p.id}`,
          title: `[${p.key}] ${p.name}`,
          uri: `${baseUrl}/browse/${p.key}`,
          content: [`${p.key} — ${p.name}`, p.description ?? ''].filter(Boolean).join('\n'),
          metadata: { type: 'project', key: p.key, jiraId: p.id },
        };
      }
      if (body.isLast !== false && (body.values ?? []).length < 50) {
        break;
      }
      if (body.isLast === true) {
        break;
      }
      startAt += body.values?.length ?? 50;
    }

    // Issues — cursor pagination on the current search endpoint.
    const fields = ['summary', 'status', 'issuetype', 'assignee', 'created', 'updated'];
    if (cfg.includeDescription) {
      fields.push('description');
    }
    const jql = buildJql({
      projectKeys: cfg.projectKeys,
      since: ctx.since,
      doneWindowDays: cfg.doneWindowDays,
      notDoneStatuses: cfg.notDoneStatuses,
    });

    let nextPageToken: string | undefined;
    for (let page = 0; ; page += 1) {
      if (page >= MAX_PAGES) {
        // Partial progress is kept (ingestion is per-document); the next run resumes from the new watermark.
        ctx.onProgress?.({ kind: 'error', message: `Jira sync stopped at the ${MAX_PAGES}-page cap (~${MAX_PAGES * PAGE_SIZE} issues); remaining issues will land on subsequent runs.` });
        break;
      }
      const res = await jiraFetch(auth, '/rest/api/3/search/jql', {
        method: 'POST',
        body: JSON.stringify({
          jql,
          maxResults: PAGE_SIZE,
          fields,
          ...(nextPageToken ? { nextPageToken } : {}),
        }),
      });
      const body = (await res.json()) as JiraSearchPage;
      for (const issue of body.issues ?? []) {
        ctx.onProgress?.({ kind: 'fetched', uri: issue.key });
        yield issueToDoc(baseUrl, issue, cfg.includeDescription, cfg.notDoneStatuses);
      }
      if (!body.nextPageToken || body.isLast === true) {
        break;
      }
      nextPageToken = body.nextPageToken;
    }
  },
};
