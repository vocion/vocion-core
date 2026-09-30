/**
 * A CHANGE TO A REPOSITORY, OPENED AS A PULL REQUEST FROM VOCION ITSELF
 * (backlog 049; Chris, 2026-09-30: "build out the Release engineer, env,
 * deploy, CI functionality"). The Release engineer owns CI, and some of what
 * breaks CI lives in files no engineer's worker may touch — the workflows
 * under `.github/workflows/`, the runner's setup, the checks' own config. So
 * the seat that owns the pipeline writes its fix itself: the files' new
 * contents become one commit on a branch of its own, through GitHub's git
 * data API (a tree over the base's tree, a commit, a ref), and a pull request
 * from that branch. Nothing is cloned and no worker runs.
 *
 * The workspace's own GitHub token does the work (`tokenForRepo`, through
 * `githubChecks.ghFor`), so when the token becomes an installation token
 * nothing here changes. A branch is `vocion/pipeline-…`, outside the factory's
 * branch prefix, so the factory's QA review never picks it up as a feature:
 * its own merge-on-green is `pipelineChange.ts`.
 */

import { call, ghFor } from './githubChecks';

/** Every branch the Release engineer opens starts here. */
export const PIPELINE_BRANCH_PREFIX = 'vocion/pipeline-';

/** One file the change writes, or removes. */
export type ChangeFile = { path: string; content?: string | null; delete?: boolean };

export type OpenedChange = {
  repo: string;
  url: string;
  number: number;
  branch: string;
  base: string;
  headSha: string;
  /** False when the branch already had an open pull request, which the commit was added to. */
  created: boolean;
  paths: string[];
};

/**
 * A branch name for a change: the prefix, the day, and a slug of its title.
 * @param title - The change's title.
 * @param now - The clock.
 */
export function branchFor(title: string, now: Date = new Date()): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'change';
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `${PIPELINE_BRANCH_PREFIX}${stamp}-${slug}`;
}

/**
 * A path is written as given, relative to the repository's root: no leading
 * slash, no `..`, no `.git/`.
 * @param path - The path.
 */
export function cleanPath(path: string): string | null {
  const p = path.trim().replace(/^\.?\/+/, '');
  if (!p || p.split('/').some(part => part === '..' || part === '') || p === '.git' || p.startsWith('.git/')) {
    return null;
  }
  return p;
}

/**
 * The repository's default branch, as GitHub has it.
 * @param orgId - The workspace.
 * @param repo - `owner/name`.
 */
export async function defaultBranch(orgId: string, repo: string): Promise<string> {
  const gh = await ghFor(orgId, repo);
  const res = await call<{ default_branch?: string }>(gh, '');
  if (!res.ok || !res.data.default_branch) {
    throw new Error(`${repo} could not be read: ${res.ok ? 'no default branch' : res.message}`);
  }
  return res.data.default_branch;
}

/**
 * Write files as one commit on a branch of their own and open (or add to) its
 * pull request. A branch that exists is continued: the commit goes on its
 * head, so a second attempt at the same fix is one more commit on the same
 * pull request.
 * @param orgId - The workspace.
 * @param o - The change.
 * @param o.repo - `owner/name`.
 * @param o.title - The pull request's title (and the commit's first line).
 * @param o.body - The pull request's description: what broke, why this fixes it, how it is undone.
 * @param o.files - The files' new contents, or `delete: true`.
 * @param o.base - The branch the change targets; the default branch when omitted.
 * @param o.branch - The branch to write; a new `vocion/pipeline-…` one when omitted.
 * @param o.now - The clock.
 */
export async function openChangePull(orgId: string, o: { repo: string; title: string; body: string; files: ChangeFile[]; base?: string | null; branch?: string | null; now?: Date }): Promise<OpenedChange> {
  const files = o.files.map((f) => {
    const path = cleanPath(f.path);
    if (!path) {
      throw new Error(`${f.path} is not a path inside the repository`);
    }
    if (!f.delete && typeof f.content !== 'string') {
      throw new Error(`${path} has no content: give its whole new text, or delete: true`);
    }
    return { path, content: f.delete ? null : f.content as string };
  });
  if (files.length === 0) {
    throw new Error('a change needs at least one file');
  }
  const gh = await ghFor(orgId, o.repo);
  const repo = `${gh.owner}/${gh.repo}`;
  const base = o.base?.trim() || await defaultBranch(orgId, repo);
  const branch = o.branch?.trim() || branchFor(o.title, o.now);
  if (!branch.startsWith(PIPELINE_BRANCH_PREFIX)) {
    throw new Error(`${branch} is not a branch this change may write: its branches start ${PIPELINE_BRANCH_PREFIX}`);
  }

  // The commit's parent: the branch's head when it exists, else the base's.
  const existing = await call<{ object?: { sha?: string } }>(gh, `/git/ref/heads/${encodeURIComponent(branch)}`);
  const from = existing.ok ? null : await call<{ object?: { sha?: string } }>(gh, `/git/ref/heads/${encodeURIComponent(base)}`);
  const parent = existing.ok ? existing.data.object?.sha : from?.ok ? from.data.object?.sha : undefined;
  if (!parent) {
    throw new Error(`${repo}@${base} could not be read${from && !from.ok ? `: ${from.message}` : ''}`);
  }
  const parentCommit = await call<{ tree?: { sha?: string } }>(gh, `/git/commits/${parent}`);
  if (!parentCommit.ok || !parentCommit.data.tree?.sha) {
    throw new Error(`commit ${parent.slice(0, 12)} on ${repo} could not be read${parentCommit.ok ? '' : `: ${parentCommit.message}`}`);
  }
  const tree = await call<{ sha: string }>(gh, '/git/trees', {
    method: 'POST',
    body: {
      base_tree: parentCommit.data.tree.sha,
      tree: files.map(f => f.content === null
        ? { path: f.path, mode: '100644', type: 'blob', sha: null }
        : { path: f.path, mode: '100644', type: 'blob', content: f.content }),
    },
  });
  if (!tree.ok) {
    throw new Error(`GitHub refused the change's files on ${repo}: ${tree.message}`);
  }
  const commit = await call<{ sha: string }>(gh, '/git/commits', { method: 'POST', body: { message: `${o.title}\n\n${o.body}`.slice(0, 10_000), tree: tree.data.sha, parents: [parent] } });
  if (!commit.ok) {
    throw new Error(`GitHub refused the commit on ${repo}: ${commit.message}`);
  }
  const ref = existing.ok
    ? await call<unknown>(gh, `/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: commit.data.sha, force: false } })
    : await call<unknown>(gh, '/git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit.data.sha } });
  if (!ref.ok) {
    throw new Error(`GitHub refused the branch ${branch} on ${repo}: ${ref.message}${ref.status === 403 || ref.status === 404 ? ' (the token needs Contents: write, and Workflows: write to change .github/workflows)' : ''}`);
  }

  const open = await call<Array<{ html_url: string; number: number }>>(gh, `/pulls?state=open&head=${encodeURIComponent(`${gh.owner}:${branch}`)}`);
  const found = open.ok ? open.data[0] : undefined;
  if (found) {
    return { repo, url: found.html_url, number: found.number, branch, base, headSha: commit.data.sha, created: false, paths: files.map(f => f.path) };
  }
  const pull = await call<{ html_url: string; number: number }>(gh, '/pulls', { method: 'POST', body: { title: o.title.slice(0, 250), head: branch, base, body: o.body.slice(0, 60_000) } });
  if (!pull.ok) {
    throw new Error(`GitHub did not open the pull request for ${branch} on ${repo}: ${pull.message}`);
  }
  return { repo, url: pull.data.html_url, number: pull.data.number, branch, base, headSha: commit.data.sha, created: true, paths: files.map(f => f.path) };
}

/**
 * Take a change back: an open pull request is closed and its branch deleted;
 * a merged one is reverted (GitHub's own revert pull request).
 * @param orgId - The workspace.
 * @param o - The change.
 * @param o.url - Its pull request.
 * @param o.repo - `owner/name`.
 * @param o.branch - Its branch.
 */
export async function discardChange(orgId: string, o: { url: string; repo: string; branch: string }): Promise<{ closed: boolean; branchDeleted: boolean; revertUrl: string | null; state: string }> {
  const { closePull, revertPull } = await import('./githubMerge');
  const closed = await closePull(orgId, o.url, 'Undone from Vocion: this change is withdrawn.');
  if (closed.state === 'merged') {
    const { revertUrl } = await revertPull(orgId, o.url);
    return { closed: false, branchDeleted: false, revertUrl, state: 'merged' };
  }
  let branchDeleted = false;
  if (o.branch.startsWith(PIPELINE_BRANCH_PREFIX)) {
    const gh = await ghFor(orgId, o.repo);
    const res = await call<unknown>(gh, `/git/refs/heads/${encodeURIComponent(o.branch)}`, { method: 'DELETE' });
    branchDeleted = res.ok;
  }
  return { closed: closed.closed, branchDeleted, revertUrl: null, state: closed.closed ? 'closed' : closed.state };
}
