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
const DIFF_MAX = 150_000;

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
  const cut = diff.length > DIFF_MAX ? `${diff.slice(0, DIFF_MAX)}\n\n[Diff truncated at ${DIFF_MAX} of ${diff.length} characters.]` : diff;
  return [
    `# ${meta.title ?? `Pull request #${pr.number}`}`,
    `${url}`,
    `State: ${meta.merged ? 'merged' : meta.state ?? 'unknown'} · ${meta.head?.ref ?? '?'} → ${meta.base?.ref ?? '?'} · head ${meta.head?.sha?.slice(0, 12) ?? '?'} · +${meta.additions ?? 0} −${meta.deletions ?? 0} in ${meta.changed_files ?? 0} files`,
    '',
    meta.body ? `## Description\n\n${meta.body.slice(0, 6000)}` : '',
    '',
    '## Diff',
    '',
    '```diff',
    cut,
    '```',
  ].join('\n');
}
