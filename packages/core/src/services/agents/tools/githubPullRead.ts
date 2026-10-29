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
 * with that source's token — never the server's, never another org's, and
 * never a connection another project holds (`connectionScope.ts`).
 */

import type { ConnectionScope } from '@/services/connect/connectionScope';
import { resolveGithubToken } from '@/libs/github/client';
import { connectionsFor, connectionsWithheld, outOfScopeLine } from '@/services/connect/connectionScope';

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

/**
 * Whether a source row is a GitHub connection. The connect form names a
 * source after its API host (`github-api-github-com`, one per GitHub
 * Enterprise host too) and records the connector as `_connector`; older
 * rows are named plain `github`. Matching the name alone missed every
 * connection made through the form, so publishing and pull-request reads
 * said the workspace had no GitHub connection while it had one.
 * @param row - The row's slug and config.
 * @param row.slug - `knowledge_source.slug`.
 * @param row.config - `knowledge_source.config_json`.
 */
export function isGithubSource(row: { slug?: string | null; config?: unknown }): boolean {
  const connector = (row.config as { _connector?: unknown } | null | undefined)?._connector;
  return connector === 'github' || row.slug === 'github';
}

/**
 * The GitHub connections this work may use that list a repository, in the
 * resolver's order (`services/connect/connectionScope.ts`): the workspace's and
 * the work's own project's, never another project's.
 * @param orgId - The workspace.
 * @param fullName - `owner/name`.
 * @param scope - The work's scope; the current work's when omitted.
 */
async function githubConnectionsListing(orgId: string, fullName: string, scope?: Partial<ConnectionScope> | null) {
  const wanted = fullName.toLowerCase();
  const lists = (config: unknown) => (Array.isArray((config as { repos?: unknown } | null)?.repos) ? (config as { repos: unknown[] }).repos.map(String) : [])
    .some(r => r.toLowerCase() === wanted);
  const rows = (await connectionsFor(orgId, scope)).filter(r => isGithubSource({ slug: r.slug, config: r.configJson }) && lists(r.configJson));
  return { rows };
}

/**
 * Why no token serves a repository for this work when one exists: the GitHub
 * connection that lists it belongs to another project. Null when none does —
 * the repository is simply not connected.
 * @param orgId - The workspace.
 * @param fullName - `owner/name`.
 * @param scope - The work's scope; the current work's when omitted.
 */
export async function repoOutOfScope(orgId: string, fullName: string, scope?: Partial<ConnectionScope> | null): Promise<string | null> {
  const wanted = fullName.toLowerCase();
  const withheld = (await connectionsWithheld(orgId, scope)).find(r => isGithubSource({ slug: r.slug, config: r.configJson })
    && Array.isArray((r.configJson as { repos?: unknown })?.repos)
    && (r.configJson as { repos: unknown[] }).repos.some(x => String(x).toLowerCase() === wanted));
  return withheld ? outOfScopeLine(`GitHub for ${fullName}`, withheld.projectTitle) : null;
}

/**
 * Why a repository cannot be used for this work although it is connected: no
 * GitHub connection in scope lists it, and one another project holds does.
 * Null when one in scope lists it, and when none lists it at all.
 * @param orgId - The workspace.
 * @param fullName - `owner/name`.
 * @param scope - The work's scope; the current work's when omitted.
 */
export async function repoScopeRefusal(orgId: string, fullName: string, scope?: Partial<ConnectionScope> | null): Promise<string | null> {
  const { rows } = await githubConnectionsListing(orgId, fullName, scope);
  return rows.length > 0 ? null : repoOutOfScope(orgId, fullName, scope);
}

/**
 * The token for a repository, for THIS work: the first GitHub connection in
 * scope that lists it and has a working credential, else null with the reason
 * when the repository is connected for another project. Use this where the
 * reason can reach a person; {@link tokenForRepo} where only the token matters.
 * @param orgId - The workspace.
 * @param fullName - `owner/name`.
 * @param scope - The work's scope; the current work's when omitted.
 */
export async function repoAccess(orgId: string, fullName: string, scope?: Partial<ConnectionScope> | null): Promise<{ token: string; refusal: null } | { token: null; refusal: string | null }> {
  const { rows } = await githubConnectionsListing(orgId, fullName, scope);
  const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
  for (const row of rows) {
    const creds = await getCredentialsForConnector({ orgId, connectorSlug: 'github', apiTokenId: row.apiTokenId }).catch(() => undefined);
    const token = (await resolveGithubToken(creds as Record<string, unknown> | undefined).catch(() => undefined)) ?? null;
    if (token) {
      return { token, refusal: null };
    }
  }
  return { token: null, refusal: rows.length === 0 ? await repoOutOfScope(orgId, fullName, scope).catch(() => null) : null };
}

/**
 * The workspace's token for a repository, for the current work (see
 * {@link repoAccess}); null when no connection in scope lists it.
 * @param orgId - The workspace.
 * @param fullName - `owner/name`.
 * @param scope - The work's scope; the current work's when omitted.
 */
export async function tokenForRepo(orgId: string, fullName: string, scope?: Partial<ConnectionScope> | null): Promise<string | null> {
  return (await repoAccess(orgId, fullName, scope)).token;
}

/**
 * The settings of the GitHub connection that lists a repository — its deploy
 * branch and branch prefix — read from the same rows as its token, through the
 * same resolver. Null when no connection in scope lists it.
 * @param orgId - The workspace.
 * @param fullName - `owner/name`.
 * @param scope - The work's scope; the current work's when omitted.
 */
export async function sourceConfigForRepo(orgId: string, fullName: string, scope?: Partial<ConnectionScope> | null): Promise<{ deployBranch: string | null; branchPrefix: string | null } | null> {
  const [row] = (await githubConnectionsListing(orgId, fullName, scope)).rows;
  if (!row) {
    return null;
  }
  const config = (row.configJson ?? {}) as { deployBranch?: unknown; branchPrefix?: unknown };
  return { deployBranch: typeof config.deployBranch === 'string' && config.deployBranch.trim() ? config.deployBranch.trim() : null, branchPrefix: typeof config.branchPrefix === 'string' && config.branchPrefix.trim() ? config.branchPrefix.trim() : null };
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
 * repository this workspace connected, so the caller falls back to the web;
 * the refusal when the repository is connected for another project.
 * @param orgId - The workspace.
 * @param url - A github.com pull request URL.
 */
export async function readConnectedPull(orgId: string, url: string): Promise<string | null> {
  const pr = parsePullUrl(url);
  if (!pr) {
    return null;
  }
  const access = await repoAccess(orgId, `${pr.owner}/${pr.repo}`);
  if (!access.token) {
    // Connected for another project: said, never a silent read of the public web.
    return access.refusal;
  }
  const token = access.token;
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
