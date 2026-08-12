/**
 * Jira connector — ingest projects and issues from a Jira Cloud site as
 * retrievable documents (key, summary, status, description).
 *
 * Auth: an Atlassian API token in `ctx.credentials` (`{ email, apiToken }`),
 * sent as Basic auth. Tokens created since Dec 2024 carry a mandatory expiry
 * (1–365 days), so a 401/403 here surfaces as an actionable "reconnect"
 * error rather than a retry loop.
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

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { z } from 'zod';

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
 * Fetch with Jira-appropriate failure handling: exact `Retry-After` on 429
 * (retrying early extends the penalty), and an actionable error on 401/403 —
 * the admin must reconnect, no amount of retrying helps.
 * @param url
 * @param init
 */
async function jiraFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, init);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Jira rejected the credentials (${res.status}). The API token may be expired or revoked — reconnect the Jira source with a fresh token from id.atlassian.com.`,
      );
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 1000;
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Jira request failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    return res;
  }
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

export const jiraConnector: SourceConnector<typeof jiraConfigSchema> = {
  slug: 'jira',
  name: 'Jira',
  description: 'Ingest Jira projects and issues (key, summary, status, description) — incremental by updated date.',
  icon: 'SquareKanban',
  authKind: 'apikey',
  configSchema: jiraConfigSchema,
  // notDoneStatuses is advanced — left off the form, schema default ([]) applies.
  configFields: [
    { key: 'baseUrl', label: 'Jira site URL', type: 'url', required: true, placeholder: 'https://acme.atlassian.net' },
    { key: 'projectKeys', label: 'Project keys', type: 'stringArray', required: true, help: 'Comma-separated, e.g. ENG, OPS' },
    { key: 'doneWindowDays', label: 'Done-issue window (days)', type: 'number', default: 90 },
    { key: 'includeDescription', label: 'Include issue description', type: 'boolean', default: true },
  ],
  defaultReconcileCron: '0 3 * * *',
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = jiraConfigSchema.parse(ctx.config);
    const email = ctx.credentials?.email as string | undefined;
    const apiToken = (ctx.credentials?.apiToken ?? ctx.credentials?.token) as string | undefined;
    if (!email || !apiToken) {
      throw new Error('Jira connector requires credentials.email and credentials.apiToken (an Atlassian API token).');
    }
    const baseUrl = cfg.baseUrl.replace(/\/$/, '');
    const headers = {
      'authorization': `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
      'accept': 'application/json',
      'content-type': 'application/json',
    };

    // Projects first — one document each, cheap enough to refresh every run.
    const wanted = new Set(cfg.projectKeys);
    let startAt = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await jiraFetch(`${baseUrl}/rest/api/3/project/search?startAt=${startAt}&maxResults=50`, { headers });
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
      const res = await jiraFetch(`${baseUrl}/rest/api/3/search/jql`, {
        method: 'POST',
        headers,
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
