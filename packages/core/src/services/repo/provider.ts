/**
 * THE REPO FAMILY — a code host, named for its constructs.
 *
 * A software factory reads and writes a few things on whatever hosts its
 * repositories: a pull request and its diff, a file at a ref, the checks on a
 * head and the pipeline runs on a branch, a comment or a review on the pull
 * request, a pipeline run cancelled or started again. GitHub is the first
 * host Vocion connects, but none of that is GitHub's: Bitbucket and Azure
 * DevOps call the same thing a pull request, GitLab a merge request; a check
 * is a pipeline step there, a workflow run a pipeline. So the agent's tools
 * are `repo_read_pull`, `repo_read_diff`, `repo_read_file`, `repo_read_tree`,
 * `repo_read_check_logs`, and the actions `repo.comment_pull`,
 * `repo.submit_review`, `repo.open_pull`, and the vendor is a provider behind
 * this interface, chosen from the URL's host or from the source a workspace
 * connected for the repository.
 *
 * A later host plugs in as another `providers/<host>.ts` implementing
 * `RepoProvider`, registered in `repoProviderFor`; nothing an agent is told,
 * no trust rule and no skill names the vendor.
 */

import { tokenForRepo } from '@/services/agents/tools/githubPullRead';

/** A pull request on a connected repository: the repository as `owner/name`, its number, its web URL. */
export type PullRequestRef = { repo: string; number: number; url: string };

/** A pipeline run on a connected repository: the repository as `owner/name` and the run's id. */
export type PipelineRunRef = { repo: string; runId: number; url: string };

/** One pull request, read live from its host. */
export type PullRequestSummary = {
  repo: string;
  number: number;
  url: string;
  title: string;
  /** The description, capped; the whole text is what the engineer wrote as its report. */
  body: string;
  author: string | null;
  state: string;
  draft: boolean;
  merged: boolean;
  mergedBy: string | null;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFileCount: number;
  /** The files it changes, capped; `changedFileCount` says how many there are. */
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
  reviews: Array<{ reviewer: string | null; state: string; submittedAt: string | null }>;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  labels: string[];
  createdAt: string;
  updatedAt: string;
};

/** A file at a ref, read through the host credential. */
export type RepoFile = { repo: string; path: string; ref: string | null; size: number; text: string; truncated: boolean };

/** One entry of a repository's tree: a file (`blob`) or a directory (`tree`), by its path from the root. */
export type RepoTreeEntry = { path: string; type: 'blob' | 'tree'; size?: number };

/**
 * A repository's whole tree at a ref, read through the host credential in one
 * call. `ref` is the one actually read (the default branch when none was
 * asked for); `truncated` when the host cut the listing short.
 */
export type RepoTree = { repo: string; ref: string; truncated: boolean; entries: RepoTreeEntry[] };

/** A review submitted on a pull request. */
export type ReviewInput = {
  event: 'approve' | 'request_changes' | 'comment';
  body: string;
  /** Findings on lines of the diff, when there are any. */
  comments?: Array<{ path: string; line: number; body: string; side?: 'LEFT' | 'RIGHT' }>;
};

export type RepoProvider = {
  /** The connector kind this provider answers for (`github`). */
  kind: 'github';
  /** The host as a person names it ("GitHub"). */
  label: string;
  /** A pull request URL's parts, or null when the URL is not one on this host. */
  parsePullRef: (url: string) => PullRequestRef | null;
  /** A pipeline run URL's parts, or null when the URL is not one on this host. */
  parseRunRef: (url: string) => PipelineRunRef | null;
  /** The web URL of a pull request, from its repository and number. */
  pullUrl: (repo: string, number: number) => string;
  readPull: (orgId: string, ref: PullRequestRef) => Promise<PullRequestSummary>;
  /** The unified diff of a pull request. */
  readPullDiff: (orgId: string, ref: PullRequestRef) => Promise<string>;
  /** The unified diff between two refs (`base...head`). */
  readCompareDiff: (orgId: string, repo: string, base: string, head: string) => Promise<string>;
  readFile: (orgId: string, repo: string, path: string, ref?: string | null) => Promise<RepoFile>;
  /** Every path in the repository at a ref — the default branch when omitted — as one listing. */
  readTree: (orgId: string, repo: string, ref?: string | null) => Promise<RepoTree>;
  /** A comment on the pull request's conversation. */
  commentPull: (orgId: string, ref: PullRequestRef, body: string) => Promise<{ commentId: number; url: string }>;
  deletePullComment: (orgId: string, repo: string, commentId: number) => Promise<void>;
  submitReview: (orgId: string, ref: PullRequestRef, review: ReviewInput) => Promise<{ reviewId: number; url: string }>;
  /** Dismiss a submitted approval or request for changes; a plain comment review cannot be dismissed. */
  dismissReview: (orgId: string, ref: PullRequestRef, reviewId: number, message: string) => Promise<void>;
  /** Cancel a pipeline run that is still running; false when it had already finished. */
  cancelPipelineRun: (orgId: string, ref: PipelineRunRef) => Promise<{ cancelled: boolean }>;
  /** Start a finished or cancelled pipeline run again, whole. */
  rerunPipelineRun: (orgId: string, ref: PipelineRunRef) => Promise<void>;
  /** The host account behind an email, when the host can say; null when it cannot or there is none. */
  findUserByEmail: (orgId: string, repo: string, email: string) => Promise<{ login: string; url: string } | null>;
};

const OWNER_NAME = /^[\w.-]+\/[\w.-]+$/;

/**
 * The host a repository or URL names, as a hostname: `github.com` for a
 * github.com URL, null for a bare `owner/name` (which has no host of its own).
 * @param repoOrUrl - A URL on the host, or a repository as `owner/name`.
 */
export function hostOf(repoOrUrl: string): string | null {
  const s = repoOrUrl.trim();
  if (OWNER_NAME.test(s)) {
    return null;
  }
  try {
    return new URL(s).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The provider for a repository or a URL on it. A github.com URL is GitHub's;
 * a bare `owner/name` is GitHub's when an enabled github source of the
 * workspace lists it. Anything else is refused by name: the factory touches
 * only repositories a source connected, and only GitHub is a connected code
 * host today.
 * @param orgId - The workspace.
 * @param repoOrUrl - A pull request, run or file URL, or a repository as `owner/name`.
 */
export async function repoProviderFor(orgId: string, repoOrUrl: string): Promise<RepoProvider> {
  const { githubRepoProvider } = await import('./providers/github');
  const host = hostOf(repoOrUrl);
  if (host === 'github.com') {
    return githubRepoProvider;
  }
  if (host === null && OWNER_NAME.test(repoOrUrl.trim())) {
    if (await tokenForRepo(orgId, repoOrUrl.trim())) {
      return githubRepoProvider;
    }
    throw new Error(`${repoOrUrl.trim()} is not a repository this workspace connected: no enabled code-host source lists it. Add it to the source's repositories, or ask with its full URL.`);
  }
  throw new Error(`${host ?? repoOrUrl} is not a code host this workspace connected. GitHub is the only connected code host today; a Bitbucket, Azure DevOps or GitLab repository needs its own connector first.`);
}

/**
 * A glob from a task contract's `allowedPaths`, as the test a changed file
 * must pass: `**` spans directories, `*` and `?` stay inside one segment, and
 * a plain path with no glob character covers itself and everything under it.
 * @param glob - One entry of `allowedPaths`.
 */
export function allowedPathMatcher(glob: string): (path: string) => boolean {
  const clean = glob.trim().replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean) {
    return () => false;
  }
  if (!/[*?[\]{}]/.test(clean)) {
    return path => path === clean || path.startsWith(`${clean}/`);
  }
  let re = '';
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i]!;
    if (c === '*') {
      if (clean[i + 1] === '*') {
        // `**/` spans zero or more directories; a trailing `**` spans the rest.
        if (clean[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const test = new RegExp(`^${re}$`);
  return path => test.test(path);
}

/**
 * The files of a change that no allowed path covers — what a reviewer holds
 * against the contract, and what an engineer must name as an assumption.
 * Empty when the contract names no paths: nothing bounded the change, which
 * is its own finding and not this one.
 * @param files - The paths a diff touches.
 * @param allowedPaths - The task contract's `allowedPaths`.
 */
export function pathsOutsideAllowed(files: readonly string[], allowedPaths: readonly string[] | null | undefined): string[] {
  const globs = (allowedPaths ?? []).map(g => String(g)).filter(g => g.trim());
  if (globs.length === 0) {
    return [];
  }
  const matchers = globs.map(allowedPathMatcher);
  return files.filter(path => !matchers.some(m => m(path)));
}

/**
 * The paths a unified diff touches, as the header lines name them, in order
 * of appearance.
 * @param diff - A unified diff.
 */
export function pathsInDiff(diff: string): string[] {
  const out: string[] = [];
  for (const m of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    // Git names both sides on the header line, the same path for a deletion
    // (the `+++ /dev/null` line below it says it is gone); the new side is the
    // name a reviewer holds against the contract.
    const path = m[2]!;
    if (!out.includes(path)) {
      out.push(path);
    }
  }
  return out;
}
