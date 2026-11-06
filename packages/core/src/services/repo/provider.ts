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
 * Two hosts are connected: GitHub (`providers/github.ts`) and GitLab
 * (`providers/gitlab.ts`), on gitlab.com or a self-managed instance. A
 * further host (Bitbucket, Azure DevOps) plugs in as another
 * `providers/<host>.ts` implementing `RepoProvider`, registered in
 * `repoProviderFor`; nothing an agent is told, no trust rule and no skill
 * names the vendor.
 *
 * A REPOSITORY IS A PATH, NOT AN OWNER AND A NAME. GitHub's are two segments
 * (`owner/name`); a GitLab project's can be nested (`group/subgroup/project`).
 * Everything here and every tool that takes a repository accepts any depth
 * ({@link REPO_PATH}); a provider that needs two segments checks for itself.
 *
 * THE FACTORY'S LOOP RIDES THE SAME SEAM. Beside what an agent reads and
 * writes, a provider answers what the factory needs to carry a change from
 * open to merged: the head a verdict binds to (`readPullHead`), the pull
 * request with its checks in the event builders' shape (`readPullState`, what
 * the five-minute reconcile reads back), the merge onto the judged head
 * (`mergePull`), the close of a replaced attempt (`closePull`), the revert
 * (`revertPull`), and the pipeline's own change (`openChange` / `discardChange`).
 */

import type { GithubCheckRun, GithubEvent, GithubPullRequest } from '@/libs/github/events';
import { tokenForRepo } from '@/services/agents/tools/githubPullRead';

/** A pull request on a connected repository: the repository's path (`owner/name`, or a nested GitLab path), its number, its web URL. */
export type PullRequestRef = { repo: string; number: number; url: string };

/** A pipeline run on a connected repository: the repository's path and the run's id. */
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

/** A file a change writes, or removes. */
export type ChangeFileInput = { path: string; content?: string | null; delete?: boolean };

/** A change opened as a pull request from Vocion itself (`repo.open_pull`). */
export type OpenedRepoChange = {
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
 * A pull request as the factory's read-backs and the event builders read it:
 * GitHub's REST field names are the repo family's lingua franca, so a GitLab
 * merge request is mapped onto them (`libs/gitlab/events.pullFromMergeRequest`)
 * and its pipeline's jobs onto check runs.
 */
export type PullState = { repo: string; pr: GithubPullRequest; checkRuns: GithubCheckRun[] };

export type RepoProvider = {
  /** The connector kind this provider answers for. */
  kind: 'github' | 'gitlab';
  /** The host as a person names it ("GitHub"). */
  label: string;
  /** A pull request URL's parts, or null when the URL is not one on this host. */
  parsePullRef: (url: string) => PullRequestRef | null;
  /** A pipeline run URL's parts, or null when the URL is not one on this host. */
  parseRunRef: (url: string) => PipelineRunRef | null;
  /** The web URL of a pull request, from its repository and number. */
  pullUrl: (repo: string, number: number) => string;
  /** The web URL of a pipeline run, from its repository and id. */
  runUrl: (repo: string, runId: number) => string;
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
  /** Delete a comment; `number` is the pull request it is on, which a host that files comments under it (GitLab) needs. */
  deletePullComment: (orgId: string, repo: string, commentId: number, number?: number) => Promise<void>;
  submitReview: (orgId: string, ref: PullRequestRef, review: ReviewInput) => Promise<{ reviewId: number; url: string }>;
  /** Dismiss a submitted approval or request for changes; a plain comment review cannot be dismissed. */
  dismissReview: (orgId: string, ref: PullRequestRef, reviewId: number, message: string) => Promise<void>;
  /** Cancel a pipeline run that is still running; false when it had already finished. */
  cancelPipelineRun: (orgId: string, ref: PipelineRunRef) => Promise<{ cancelled: boolean }>;
  /** Start a finished or cancelled pipeline run again, whole. */
  rerunPipelineRun: (orgId: string, ref: PipelineRunRef) => Promise<void>;
  /** The host account behind an email, when the host can say; null when it cannot or there is none. */
  findUserByEmail: (orgId: string, repo: string, email: string) => Promise<{ login: string; url: string } | null>;
  /** The head a pull request points at now, with its state; null when it could not be read. A verdict binds to this. */
  readPullHead: (orgId: string, ref: PullRequestRef) => Promise<{ sha: string; state: string; merged: boolean } | null>;
  /** The pull request and the checks on its head, in the event builders' shape. Throws when it cannot be read. */
  readPullState: (orgId: string, ref: PullRequestRef) => Promise<PullState>;
  /**
   * Merge onto the head QA judged, only with every check green. `event` is
   * the `pr.merged` this merge earned, in the same shape and key the sync
   * would raise, so whichever lands second is absorbed.
   */
  mergePull: (orgId: string, ref: PullRequestRef, judgedSha: string | null) => Promise<{ sha: string | null; already: boolean; event: GithubEvent | null }>;
  /** Close an open pull request with one comment; merged or closed is not an error. */
  closePull: (orgId: string, ref: PullRequestRef, comment: string) => Promise<{ closed: boolean; state: string }>;
  /** Undo a merge: open the revert as a new pull request. */
  revertPull: (orgId: string, ref: PullRequestRef) => Promise<{ revertUrl: string }>;
  /** Files written as one commit on a branch of their own, and the pull request from it. */
  openChange: (orgId: string, o: { repo: string; title: string; body: string; files: ChangeFileInput[]; base?: string | null; branch?: string | null }) => Promise<OpenedRepoChange>;
  /** Undo a change: close it and delete its branch, or open the revert once it merged. */
  discardChange: (orgId: string, o: { url: string; repo: string; branch: string }) => Promise<{ closed: boolean; branchDeleted: boolean; revertUrl: string | null; state: string }>;
};

/**
 * A repository as a path: two or more segments (`owner/name`,
 * `group/subgroup/project`), each letters, digits, `_`, `-` or `.`.
 */
export const REPO_PATH = /^[\w.-]+(?:\/[\w.-]+)+$/;

/**
 * The host a repository or URL names, as a hostname: `github.com` for a
 * github.com URL, null for a bare `owner/name` (which has no host of its own).
 * @param repoOrUrl - A URL on the host, or a repository as `owner/name`.
 */
export function hostOf(repoOrUrl: string): string | null {
  const s = repoOrUrl.trim();
  if (REPO_PATH.test(s)) {
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
 * a gitlab.com URL, or one on a self-managed instance an enabled gitlab source
 * names, is GitLab's. A bare path is the provider's whose enabled source lists
 * it (GitHub first, as it always was). Anything else is refused by name: the
 * factory touches only repositories a source connected.
 * @param orgId - The workspace.
 * @param repoOrUrl - A pull request, run or file URL, or a repository path.
 */
export async function repoProviderFor(orgId: string, repoOrUrl: string): Promise<RepoProvider> {
  const host = hostOf(repoOrUrl);
  if (host === 'github.com') {
    return (await import('./providers/github')).githubRepoProvider;
  }
  const gitlab = await import('./gitlabAccess');
  if (host === 'gitlab.com' || (host !== null && await gitlab.gitlabHostConnected(orgId, host))) {
    const { gitlabRepoProviderOn } = await import('./providers/gitlab');
    return gitlabRepoProviderOn(await gitlab.gitlabBaseUrlFor(orgId, { host }));
  }
  const path = repoOrUrl.trim();
  if (host === null && REPO_PATH.test(path)) {
    if (await tokenForRepo(orgId, path)) {
      return (await import('./providers/github')).githubRepoProvider;
    }
    if (await gitlab.gitlabListsProject(orgId, path)) {
      const { gitlabRepoProviderOn } = await import('./providers/gitlab');
      return gitlabRepoProviderOn(await gitlab.gitlabBaseUrlFor(orgId, { project: path }));
    }
    throw new Error(`${path} is not a repository this workspace connected: no enabled code-host source lists it. Add it to the source's repositories (GitHub) or projects (GitLab), or ask with its full URL.`);
  }
  throw new Error(`${host ?? repoOrUrl} is not a code host this workspace connected. GitHub and GitLab (gitlab.com, or a self-managed instance a gitlab source names) are the connected code hosts; a Bitbucket or Azure DevOps repository needs its own connector first.`);
}

/**
 * The provider and parsed ref for a pull request URL, or null when no
 * connected host recognises it as a pull request. Never throws.
 * @param orgId - The workspace.
 * @param url - A pull (or merge) request URL.
 */
export async function pullAt(orgId: string, url: string): Promise<{ provider: RepoProvider; ref: PullRequestRef } | null> {
  const provider = await repoProviderFor(orgId, url).catch(() => null);
  const ref = provider?.parsePullRef(url) ?? null;
  return provider && ref ? { provider, ref } : null;
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
