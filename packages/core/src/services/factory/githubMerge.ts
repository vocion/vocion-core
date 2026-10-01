/**
 * MERGING IS ONE PRESS, AND UNDO IS A REVERT (Chris, 2026-09-29, on #201 at
 * "Review the merge": "simplify my work"). The merge card used to be a
 * hand-off — approve here, then merge on GitHub. It now merges the pull
 * request itself with the workspace's own GitHub token, and only onto the
 * commit QA judged with every check green; Undo opens the revert pull request.
 */

import { parsePullUrl, tokenForRepo } from '@/services/agents/tools/githubPullRead';

const HEADERS = (token: string) => ({ 'authorization': `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion', 'accept': 'application/vnd.github+json' });

/** Check-run conclusions that let a merge through. */
const PASSING = new Set(['success', 'neutral', 'skipped']);

/**
 * Whether a commit's checks allow a merge: every check run finished and passed.
 * @param runs - The commit's check runs.
 */
export function checksAllowMerge(runs: ReadonlyArray<{ name: string; status: string; conclusion: string | null }>): { ok: true } | { ok: false; why: string } {
  const open = runs.filter(r => r.status !== 'completed');
  if (open.length > 0) {
    return { ok: false, why: `${open.length} check${open.length === 1 ? ' is' : 's are'} still running (${open.slice(0, 3).map(r => r.name).join(', ')})` };
  }
  const failed = runs.filter(r => !PASSING.has(String(r.conclusion)));
  if (failed.length > 0) {
    return { ok: false, why: `${failed.length} check${failed.length === 1 ? '' : 's'} failed (${failed.slice(0, 3).map(r => r.name).join(', ')})` };
  }
  return { ok: true };
}

type Pull = { owner: string; repo: string; number: number; token: string };

async function pullFor(orgId: string, url: string): Promise<Pull> {
  const pr = parsePullUrl(url);
  if (!pr) {
    throw new Error(`${url} is not a GitHub pull request`);
  }
  const token = await tokenForRepo(orgId, `${pr.owner}/${pr.repo}`);
  if (!token) {
    throw new Error(`this workspace has no GitHub connection for ${pr.owner}/${pr.repo}`);
  }
  return { ...pr, token };
}

/**
 * Merge a pull request (squash), only onto the commit QA judged and only with
 * its checks green. Already merged is not an error.
 * @param orgId - The workspace.
 * @param url - The pull request.
 * @param judgedSha - The commit QA's verdict is about.
 */
export async function mergePull(orgId: string, url: string, judgedSha: string | null): Promise<{ merged: true; sha: string | null; already: boolean }> {
  const p = await pullFor(orgId, url);
  const base = `https://api.github.com/repos/${p.owner}/${p.repo}`;
  const res = await fetch(`${base}/pulls/${p.number}`, { headers: HEADERS(p.token), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`GitHub did not return ${url} (HTTP ${res.status})`);
  }
  const meta = await res.json() as { merged?: boolean; merge_commit_sha?: string | null; state?: string; head?: { sha?: string } };
  if (meta.merged) {
    return { merged: true, sha: meta.merge_commit_sha ?? null, already: true };
  }
  if (meta.state !== 'open') {
    throw new Error(`${url} is ${meta.state ?? 'not open'}, so there is nothing to merge`);
  }
  const head = meta.head?.sha ?? '';
  if (judgedSha && !head.startsWith(judgedSha.slice(0, 7))) {
    throw new Error(`the branch moved after QA's verdict (judged ${judgedSha.slice(0, 12)}, head is ${head.slice(0, 12)}); QA must look at the new commit first`);
  }
  const checks = await fetch(`${base}/commits/${head}/check-runs?per_page=100`, { headers: HEADERS(p.token), signal: AbortSignal.timeout(20_000) });
  if (checks.ok) {
    const body = await checks.json() as { check_runs?: Array<{ name: string; status: string; conclusion: string | null }> };
    const verdict = checksAllowMerge(body.check_runs ?? []);
    if (!verdict.ok) {
      throw new Error(`not merged: ${verdict.why}`);
    }
  }
  const put = await fetch(`${base}/pulls/${p.number}/merge`, {
    method: 'PUT',
    headers: { ...HEADERS(p.token), 'content-type': 'application/json' },
    body: JSON.stringify({ merge_method: 'squash', sha: head }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!put.ok) {
    const why = await put.text().catch(() => '');
    throw new Error(`GitHub refused the merge (HTTP ${put.status}): ${why.slice(0, 200)}`);
  }
  const done = await put.json() as { sha?: string };
  return { merged: true, sha: done.sha ?? null, already: false };
}

/**
 * What a pull request is, as GitHub has it: its title, whether and when it
 * merged. What a revert card says it would undo, and what its guard reads.
 * @param orgId - The workspace.
 * @param url - The pull request.
 */
export async function readPull(orgId: string, url: string): Promise<{ title: string; merged: boolean; mergedAt: string | null; state: string }> {
  const p = await pullFor(orgId, url);
  const res = await fetch(`https://api.github.com/repos/${p.owner}/${p.repo}/pulls/${p.number}`, { headers: HEADERS(p.token), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`GitHub did not return ${url} (HTTP ${res.status})`);
  }
  const meta = await res.json() as { title?: string; merged?: boolean; merged_at?: string | null; state?: string };
  return { title: String(meta.title ?? ''), merged: Boolean(meta.merged), mergedAt: meta.merged_at ?? null, state: String(meta.state ?? 'unknown') };
}

/**
 * Undo a merge: open the revert pull request GitHub builds for it.
 * @param orgId - The workspace.
 * @param url - The merged pull request.
 */
export async function revertPull(orgId: string, url: string): Promise<{ revertUrl: string }> {
  const p = await pullFor(orgId, url);
  const res = await fetch(`https://api.github.com/repos/${p.owner}/${p.repo}/pulls/${p.number}`, { headers: HEADERS(p.token), signal: AbortSignal.timeout(20_000) });
  const meta = res.ok ? await res.json() as { node_id?: string } : {};
  if (!meta.node_id) {
    throw new Error(`GitHub did not return ${url}, so no revert was opened`);
  }
  const gql = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...HEADERS(p.token), 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'mutation($id: ID!) { revertPullRequest(input: { pullRequestId: $id }) { revertPullRequest { url } } }', variables: { id: meta.node_id } }),
    signal: AbortSignal.timeout(30_000),
  });
  const out = await gql.json().catch(() => ({})) as { data?: { revertPullRequest?: { revertPullRequest?: { url?: string } } }; errors?: Array<{ message?: string }> };
  const revertUrl = out.data?.revertPullRequest?.revertPullRequest?.url;
  if (!revertUrl) {
    throw new Error(`GitHub did not open the revert: ${out.errors?.[0]?.message ?? `HTTP ${gql.status}`}`);
  }
  return { revertUrl };
}

/**
 * Close a pull request with one comment saying why. Merged or already closed
 * is not an error: there is nothing to close. The branch is left alone, so a
 * later attempt can still continue from it.
 * @param orgId - The workspace.
 * @param url - The pull request.
 * @param comment - Why it is closed, in the words the PR page shows.
 */
export async function closePull(orgId: string, url: string, comment: string): Promise<{ closed: boolean; state: string }> {
  const p = await pullFor(orgId, url);
  const base = `https://api.github.com/repos/${p.owner}/${p.repo}`;
  const res = await fetch(`${base}/pulls/${p.number}`, { headers: HEADERS(p.token), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`GitHub did not return ${url} (HTTP ${res.status})`);
  }
  const meta = await res.json() as { merged?: boolean; state?: string };
  if (meta.merged || meta.state !== 'open') {
    return { closed: false, state: meta.merged ? 'merged' : String(meta.state ?? 'unknown') };
  }
  await fetch(`${base}/issues/${p.number}/comments`, {
    method: 'POST',
    headers: { ...HEADERS(p.token), 'content-type': 'application/json' },
    body: JSON.stringify({ body: comment }),
    signal: AbortSignal.timeout(20_000),
  });
  const patch = await fetch(`${base}/pulls/${p.number}`, {
    method: 'PATCH',
    headers: { ...HEADERS(p.token), 'content-type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!patch.ok) {
    throw new Error(`GitHub refused to close ${url} (HTTP ${patch.status})`);
  }
  return { closed: true, state: 'closed' };
}
