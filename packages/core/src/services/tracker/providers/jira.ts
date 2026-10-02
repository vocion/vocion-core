/**
 * JIRA — the first provider of the tracker family (`../provider.ts`).
 *
 * One authenticated client per call, built the way the `jira` source syncs
 * (`libs/sources/jira.ts`: a pasted API token as Basic auth against the site,
 * or an Atlassian grant as a Bearer token against api.atlassian.com with the
 * rotated refresh token persisted), so a write made by an agent and a read
 * made by the sync fail and recover the same way.
 *
 * Jira Cloud REST v3 facts this file depends on: search is
 * `POST /rest/api/3/search/jql` paginated by `nextPageToken`; descriptions
 * and comments are Atlassian Document Format, so plain text is turned into
 * ADF on the way in (`textToAdf`) and flattened on the way out (`adfToText`);
 * an attachment upload is multipart with `X-Atlassian-Token: no-check`; a
 * status change is a transition (`GET/POST /issue/{key}/transitions`); a link
 * to a page outside Jira is a remote issue link (`/issue/{key}/remotelink`).
 */

import type { TrackerIssue, TrackerPreviousFields, TrackerProvider, TrackerSearchRow, TrackerTransition } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { JiraAuth } from '@/libs/sources/jira';
import { Buffer } from 'node:buffer';
import { adfToText, jiraFetch, jqlQuote, resolveJiraAuth } from '@/libs/sources/jira';
import { getCredentialsForConnector } from '@/services/SourceCredentialService';
import { projectKeysOf } from '../provider';

type AdfNode = { type: string; text?: string; content?: AdfNode[]; attrs?: Record<string, unknown> };

/**
 * Plain text as an Atlassian Document Format document: a paragraph per
 * blank-line-separated block, a hard break for a single newline inside one.
 * Jira's v3 comment and description fields take nothing else.
 * @param text - What the agent wrote.
 */
export function textToAdf(text: string): AdfNode {
  const blocks = text.replaceAll('\r\n', '\n').split(/\n{2,}/).map(b => b.replace(/^\n+|\n+$/g, '')).filter(b => b !== '');
  const paragraphs: AdfNode[] = blocks.map((block) => {
    const lines = block.split('\n');
    const content: AdfNode[] = [];
    lines.forEach((line, i) => {
      if (i > 0) {
        content.push({ type: 'hardBreak' });
      }
      if (line !== '') {
        content.push({ type: 'text', text: line });
      }
    });
    return { type: 'paragraph', content };
  });
  return { type: 'doc', version: 1, content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph', content: [] }] } as AdfNode;
}

type JiraUser = { accountId?: string; displayName?: string; emailAddress?: string } | null;
type JiraIssueFull = {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: AdfNode | null;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    priority?: { name?: string } | null;
    labels?: string[];
    assignee?: JiraUser;
    reporter?: JiraUser;
    created?: string;
    updated?: string;
    fixVersions?: Array<{ name?: string }>;
    comment?: { comments?: Array<{ id: string; author?: JiraUser; created?: string; body?: AdfNode | null }> };
    attachment?: Array<{ id: string; filename?: string; mimeType?: string; size?: number; created?: string }>;
    issuelinks?: Array<{ type?: { name?: string; inward?: string; outward?: string }; inwardIssue?: { key: string; fields?: { summary?: string } }; outwardIssue?: { key: string; fields?: { summary?: string } } }>;
  };
};
type JiraTransitionsPage = { transitions?: Array<{ id: string; name: string; to?: { name?: string } }> };
type JiraSearchPage = { issues?: JiraIssueFull[]; nextPageToken?: string };

const ISSUE_FIELDS = 'summary,description,status,issuetype,priority,labels,assignee,reporter,created,updated,fixVersions,comment,attachment,issuelinks';
const SEARCH_FIELDS = 'summary,status,assignee,updated,priority';

/** Jira's ordering for `orderBy: 'priority'`: highest priority first, oldest first within one. */
const PRIORITY_ORDER = 'ORDER BY priority DESC, created ASC';

async function authFor(orgId: string, source: FamilySource): Promise<JiraAuth> {
  const baseUrl = String((source.config as { baseUrl?: unknown }).baseUrl ?? '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error(`The ${source.slug} source names no Jira site (baseUrl).`);
  }
  const credentials = await getCredentialsForConnector({ orgId, connectorSlug: source.slug, apiTokenId: source.apiTokenId }).catch(() => undefined)
    ?? await getCredentialsForConnector({ orgId, connectorSlug: 'jira', apiTokenId: null }).catch(() => undefined);
  return resolveJiraAuth({
    baseUrl,
    credentials: credentials as Record<string, unknown> | undefined,
    persistence: { kind: 'persist', orgId, warn: message => console.warn('[tracker/jira]', message) },
  });
}

function userName(user: JiraUser | undefined): string | null {
  return user?.displayName ?? user?.emailAddress ?? null;
}

function toIssue(siteUrl: string, issue: JiraIssueFull, transitions: TrackerTransition[]): TrackerIssue {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    url: `${siteUrl}/browse/${issue.key}`,
    summary: f.summary ?? '',
    description: adfToText(f.description),
    status: f.status?.name ?? 'Unknown',
    statusCategory: f.status?.statusCategory?.key ?? null,
    issueType: f.issuetype?.name ?? null,
    priority: f.priority?.name ?? null,
    labels: f.labels ?? [],
    assignee: userName(f.assignee),
    reporter: userName(f.reporter),
    created: f.created ?? null,
    updated: f.updated ?? null,
    fixVersions: (f.fixVersions ?? []).map(v => v.name ?? '').filter(Boolean),
    comments: (f.comment?.comments ?? []).map(c => ({ id: c.id, author: userName(c.author), created: c.created ?? null, body: adfToText(c.body) })),
    attachments: (f.attachment ?? []).map(a => ({ id: a.id, filename: a.filename ?? '', mimeType: a.mimeType ?? null, size: a.size ?? null, created: a.created ?? null })),
    links: (f.issuelinks ?? []).flatMap((l) => {
      const other = l.inwardIssue ?? l.outwardIssue;
      if (!other) {
        return [];
      }
      const type = l.inwardIssue ? (l.type?.inward ?? l.type?.name ?? 'linked') : (l.type?.outward ?? l.type?.name ?? 'linked');
      return [{ type, key: other.key, summary: other.fields?.summary ?? null }];
    }),
    transitions,
  };
}

/**
 * The Jira provider for one tracker source.
 * @param orgId - The workspace.
 * @param source - The `jira` source row (site, project keys, credential).
 */
export async function jiraTrackerProvider(orgId: string, source: FamilySource): Promise<TrackerProvider> {
  const auth = await authFor(orgId, source);
  const projectKeys = projectKeysOf(source);
  const issueUrl = (key: string): string => `${auth.siteUrl}/browse/${key}`;

  const json = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await jiraFetch(auth, path, init);
    const text = await res.text().catch(() => '');
    return (text ? JSON.parse(text) : undefined) as T;
  };
  const post = (path: string, body: unknown, method = 'POST'): Promise<Response> => jiraFetch(auth, path, { method, body: JSON.stringify(body) });

  const transitions = async (key: string): Promise<TrackerTransition[]> => {
    const page = await json<JiraTransitionsPage>(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    return (page.transitions ?? []).map(t => ({ id: t.id, name: t.name, to: t.to?.name ?? t.name }));
  };

  const readIssue = async (key: string): Promise<TrackerIssue> => {
    const [issue, moves] = await Promise.all([
      json<JiraIssueFull>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}`),
      transitions(key).catch(() => [] as TrackerTransition[]),
    ]);
    return toIssue(auth.siteUrl, issue, moves);
  };

  return {
    kind: 'jira',
    sourceSlug: source.slug,
    projectKeys,
    issueUrl,
    readIssue,
    transitions,
    async searchIssues(query, limit, orderBy) {
      if (projectKeys.length === 0) {
        throw new Error(`The ${source.slug} source lists no project keys, so there is nothing to search.`);
      }
      const projects = `project in (${projectKeys.map(jqlQuote).join(', ')})`;
      const trimmed = query.trim();
      // The ordering goes AFTER the bounded clause, never inside the wrap, so a
      // query cannot reach past the configured projects and the ORDER BY stays valid JQL.
      const bounded = trimmed ? `${projects} AND (${trimmed})` : projects;
      const jql = orderBy === 'priority' ? `${bounded} ${PRIORITY_ORDER}` : trimmed ? bounded : `${bounded} ORDER BY updated DESC`;
      const rows: TrackerSearchRow[] = [];
      let nextPageToken: string | undefined;
      do {
        const page = await json<JiraSearchPage>('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql, maxResults: Math.min(limit, 50), fields: SEARCH_FIELDS.split(','), ...(nextPageToken ? { nextPageToken } : {}) }) });
        for (const issue of page.issues ?? []) {
          rows.push({ key: issue.key, summary: issue.fields?.summary ?? '', status: issue.fields?.status?.name ?? 'Unknown', assignee: userName(issue.fields?.assignee), updated: issue.fields?.updated ?? null, url: issueUrl(issue.key), priority: issue.fields?.priority?.name ?? null });
          if (rows.length >= limit) {
            return rows;
          }
        }
        nextPageToken = page.nextPageToken;
      } while (nextPageToken && rows.length < limit);
      return rows;
    },
    async readAttachment(id) {
      const meta = await json<{ filename?: string; mimeType?: string; content?: string }>(`/rest/api/3/attachment/${encodeURIComponent(id)}`);
      const res = await jiraFetch(auth, `/rest/api/3/attachment/content/${encodeURIComponent(id)}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      return { filename: meta.filename ?? `attachment-${id}`, mimeType: meta.mimeType ?? res.headers.get('content-type') ?? 'application/octet-stream', bytes };
    },
    async createIssue(input) {
      const created = await json<{ key: string }>('/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            project: { key: input.projectKey },
            issuetype: { name: input.issueType },
            summary: input.summary,
            description: textToAdf(input.description),
            ...(input.labels?.length ? { labels: input.labels } : {}),
            ...(input.priority ? { priority: { name: input.priority } } : {}),
          },
        }),
      });
      return { key: created.key, url: issueUrl(created.key) };
    },
    async deleteIssue(key) {
      await jiraFetch(auth, `/rest/api/3/issue/${encodeURIComponent(key)}`, { method: 'DELETE' });
    },
    async transition(key, to) {
      const [moves, issue] = await Promise.all([transitions(key), json<JiraIssueFull>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=status`)]);
      const wanted = to.trim().toLowerCase();
      const move = moves.find(m => m.id === to.trim()) ?? moves.find(m => m.to.toLowerCase() === wanted) ?? moves.find(m => m.name.toLowerCase() === wanted);
      if (!move) {
        throw new Error(`${key} has no transition to "${to}" from ${issue.fields?.status?.name ?? 'its status'}. Available: ${moves.map(m => `${m.name} → ${m.to}`).join(', ') || 'none'}.`);
      }
      await post(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: move.id } });
      return { from: issue.fields?.status?.name ?? 'Unknown', to: move.to };
    },
    async updateIssue(key, fields) {
      const before = await json<JiraIssueFull>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=priority,labels,fixVersions`);
      const previous: TrackerPreviousFields = {};
      const update: Record<string, unknown> = {};
      if (fields.priority !== undefined) {
        previous.priority = before.fields?.priority?.name ?? null;
        update.priority = { name: fields.priority };
      }
      if (fields.labels !== undefined) {
        previous.labels = before.fields?.labels ?? [];
        update.labels = fields.labels;
      }
      if (fields.fixVersion !== undefined) {
        previous.fixVersions = (before.fields?.fixVersions ?? []).map(v => v.name ?? '').filter(Boolean);
        update.fixVersions = [...previous.fixVersions.map(name => ({ name })), { name: fields.fixVersion }];
      }
      if (Object.keys(update).length > 0) {
        await post(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: update }, 'PUT');
      }
      if (fields.remoteLink) {
        const link = await json<{ id?: number | string }>(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`, { method: 'POST', body: JSON.stringify({ object: { url: fields.remoteLink.url, title: fields.remoteLink.title } }) });
        previous.remoteLinkId = link?.id !== undefined ? String(link.id) : null;
      }
      return previous;
    },
    async removeRemoteLink(key, linkId) {
      await jiraFetch(auth, `/rest/api/3/issue/${encodeURIComponent(key)}/remotelink/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
    },
    async addComment(key, text) {
      const created = await json<{ id: string }>(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { method: 'POST', body: JSON.stringify({ body: textToAdf(text) }) });
      return { id: created.id, url: `${issueUrl(key)}?focusedCommentId=${created.id}` };
    },
    async deleteComment(key, id) {
      await jiraFetch(auth, `/rest/api/3/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async attach(key, file) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.filename);
      // The multipart boundary is the body's; the JSON content-type the auth
      // headers carry would break it, so it is dropped here.
      await auth.ensureFresh();
      const headers = Object.fromEntries(Object.entries(auth.headers()).filter(([k]) => k.toLowerCase() !== 'content-type'));
      const res = await fetch(`${auth.apiBase}/rest/api/3/issue/${encodeURIComponent(key)}/attachments`, { method: 'POST', headers: { ...headers, 'X-Atlassian-Token': 'no-check' }, body: form });
      if (!res.ok) {
        throw new Error(`Jira did not take the attachment: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const [created] = (await res.json()) as Array<{ id: string }>;
      if (!created?.id) {
        throw new Error('Jira answered the upload without an attachment id.');
      }
      return { id: created.id };
    },
    async deleteAttachment(id) {
      await jiraFetch(auth, `/rest/api/3/attachment/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async findUserByEmail(email) {
      const users = await json<Array<{ accountId?: string; displayName?: string; emailAddress?: string }>>(`/rest/api/3/user/search?query=${encodeURIComponent(email)}`);
      const user = (users ?? []).find(u => u.emailAddress?.toLowerCase() === email.toLowerCase()) ?? users?.[0];
      return user?.accountId ? { accountId: user.accountId, displayName: user.displayName ?? '' } : null;
    },
  };
}
