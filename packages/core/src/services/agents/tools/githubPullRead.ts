/**
 * A pull request on a repository this workspace connected, read with the
 * workspace's own GitHub token.
 *
 * WHY (red team, 2026-09-26): the QA reviewer judged PR #35 on
 * Meta-CTO/squatch-core without reading it — every fetch of the PR, its
 * .diff and /files was a 404, because the repository is private and fetch_url
 * reads the public web. The workspace already holds a token for that repo on
 * its `github` source; a reviewer that cannot read the change it reviews is
 * reviewing a description.
 *
 * Only a repository the workspace's enabled `github` source lists is read,
 * with that source's token — never the server's, never another org's.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { tokenFromCredentials } from '@/libs/github/client';
import { knowledgeSourceSchema } from '@/models/Schema';

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/files|\.diff|\.patch)?\/?(?:[?#].*)?$/i;
// Enough for a factory-sized change; a reviewer drowned in diff runs out of
// room to write its verdict (mission run 5364).
const DIFF_MAX = 60_000;
// The whole read stays under the runtime's eviction line (4 × 20,000 tokens'
// worth of characters in deepagents), so the model sees all of it.
const READ_MAX = 72_000;
const BODY_MAX = 20_000;

export function parsePullUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = PR_URL.exec(url.trim());
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null;
}

async function tokenForRepo(orgId: string, fullName: string): Promise<string | null> {
  const rows = await db
    .select({ config: knowledgeSourceSchema.configJson, apiTokenId: knowledgeSourceSchema.apiTokenId })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, 'github'), eq(knowledgeSourceSchema.enabled, 'true')));
  const wanted = fullName.toLowerCase();
  const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
  for (const row of rows) {
    const repos = Array.isArray((row.config as { repos?: unknown })?.repos) ? ((row.config as { repos: string[] }).repos) : [];
    if (!repos.some(r => r.toLowerCase() === wanted)) {
      continue;
    }
    const creds = await getCredentialsForConnector({ orgId, connectorSlug: 'github', apiTokenId: row.apiTokenId }).catch(() => undefined);
    const token = tokenFromCredentials(creds as Record<string, unknown> | undefined) ?? null;
    if (token) {
      return token;
    }
  }
  return null;
}

/**
 * The head a pull request points at right now, read with the workspace's own
 * token. A verdict binds to this, never to a sha the model typed. Null when the
 * URL is not a pull request on a connected repository or GitHub did not answer.
 * @param orgId - The workspace.
 * @param url - A github.com pull request URL.
 */
export async function readPullHead(orgId: string, url: string): Promise<{ sha: string; state: string; merged: boolean } | null> {
  const pr = parsePullUrl(url);
  if (!pr) {
    return null;
  }
  const token = await tokenForRepo(orgId, `${pr.owner}/${pr.repo}`);
  if (!token) {
    return null;
  }
  const res = await fetch(`https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`, {
    headers: { 'authorization': `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion', 'accept': 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) {
    return null;
  }
  const meta = await res.json() as { state?: string; merged?: boolean; head?: { sha?: string } };
  return meta.head?.sha ? { sha: meta.head.sha, state: meta.state ?? 'unknown', merged: meta.merged === true } : null;
}

/**
 * The pull request as text a reviewer reads: title, state, branches, body,
 * then the unified diff. Null when the URL is not a pull request on a
 * repository this workspace connected, so the caller falls back to the web.
 * @param orgId - The workspace.
 * @param url - A github.com pull request URL.
 */
export async function readConnectedPull(orgId: string, url: string): Promise<string | null> {
  const pr = parsePullUrl(url);
  if (!pr) {
    return null;
  }
  const token = await tokenForRepo(orgId, `${pr.owner}/${pr.repo}`);
  if (!token) {
    return null;
  }
  const base = `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;
  const headers = { 'authorization': `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion' };
  const [metaRes, diffRes] = await Promise.all([
    fetch(base, { headers: { ...headers, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) }),
    fetch(base, { headers: { ...headers, accept: 'application/vnd.github.v3.diff' }, signal: AbortSignal.timeout(30_000) }),
  ]);
  if (!metaRes.ok) {
    return `Could not read ${pr.owner}/${pr.repo}#${pr.number} with this workspace's GitHub token: HTTP ${metaRes.status}.`;
  }
  const meta = await metaRes.json() as { title?: string; state?: string; merged?: boolean; head?: { ref?: string; sha?: string }; base?: { ref?: string }; body?: string | null; additions?: number; deletions?: number; changed_files?: number };
  const diff = diffRes.ok ? await diffRes.text() : `(diff unavailable: HTTP ${diffRes.status})`;
  return composePullText(url, pr.number, meta, diff);
}

type PullMeta = { title?: string; state?: string; merged?: boolean; head?: { ref?: string; sha?: string }; base?: { ref?: string }; body?: string | null; additions?: number; deletions?: number; changed_files?: number };

/**
 * The pull request as one read the model sees whole.
 * @param url - The pull request URL.
 * @param number - Its number.
 * @param meta - GitHub's pull request object.
 * @param diff - The unified diff.
 */
export function composePullText(url: string, number: number, meta: PullMeta, diff: string): string {
  // ONE READ, UNDER THE EVICTION LINE. The agent runtime moves any tool result
  // over 80,000 characters to a file and shows the model a preview; a 20,000
  // body plus a 60,000 diff crossed it, and QA saw the first evidence lines
  // and called the rest missing (#131 attempt 173). The body — contract and
  // evidence — always comes whole; the diff gets what room is left.
  const body = meta.body ? meta.body.slice(0, BODY_MAX) : '';
  const diffRoom = Math.max(4_000, Math.min(DIFF_MAX, READ_MAX - body.length - 2_000));
  const cut = diff.length > diffRoom ? `${diff.slice(0, diffRoom)}\n\n[Diff truncated at ${diffRoom} of ${diff.length} characters, to keep this read whole.]` : diff;
  return [
    `# ${meta.title ?? `Pull request #${number}`}`,
    `${url}`,
    `State: ${meta.merged ? 'merged' : meta.state ?? 'unknown'} · ${meta.head?.ref ?? '?'} → ${meta.base?.ref ?? '?'} · head ${meta.head?.sha?.slice(0, 12) ?? '?'} · +${meta.additions ?? 0} −${meta.deletions ?? 0} in ${meta.changed_files ?? 0} files`,
    '',
    // The body is where the worker lists its evidence; a reviewer that sees
    // only its first 6,000 characters misses it (#131 attempt 169).
    body ? `## Description\n\n${body}` : '',
    '',
    '## Diff',
    '',
    '```diff',
    cut,
    '```',
  ].join('\n');
}
