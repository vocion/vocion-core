/**
 * A person's own GitHub, read with THEIR user token: what is on them, and one
 * issue or pull request in full (docs/guides/personal-connections.md). Only
 * GETs: nothing here comments, reviews, merges or closes.
 *
 * A GitHub App's user token expires after eight hours and comes with a
 * refresh token. {@link usableGithubToken} renews it on the app it was issued
 * to and saves the new pair to the same row, compare-and-swap on the refresh
 * token, so two turns renewing at once cannot strand each other.
 */

import { loginClientForGrant } from '@/libs/connect/loginClient';
import { grantExpiresAt, grantIsExpiring } from '@/libs/connect/loginGrant';
import { GITHUB_API_URL } from '@/libs/github/client';
import { updateLoginCredentialValues } from '@/services/ApiTokenService';

const TIMEOUT_MS = 20_000;
const HEADERS = { 'accept': 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion-personal' };

/** GitHub said no, with the status a person can be told. */
export class GithubCallError extends Error {
  constructor(public readonly what: string, public readonly status: number) {
    super(`GitHub refused ${what} (${status})`);
    this.name = 'GithubCallError';
  }
}

/**
 * The access token to call GitHub with: the stored one while it is good,
 * renewed and saved once it is expiring.
 * @param input - Where the login is stored, its row and its bag.
 * @param input.orgId - The person's personal workspace.
 * @param input.tokenId - The login row.
 * @param input.values - The bag `personalCredential` returned.
 */
export async function usableGithubToken(input: { orgId: string; tokenId: string; values: Record<string, unknown> }): Promise<string> {
  const { values } = input;
  const token = typeof values.token === 'string' ? values.token : '';
  const refreshToken = typeof values.refreshToken === 'string' ? values.refreshToken : '';
  const expiresAt = typeof values.expiresAt === 'string' ? values.expiresAt : '';
  if (!refreshToken || !expiresAt || !grantIsExpiring(expiresAt)) {
    return token;
  }
  const client = await loginClientForGrant({ orgId: input.orgId, provider: 'github', vendor: 'GitHub', loginClientId: values.loginClientId });
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'accept': 'application/json', 'content-type': 'application/json', 'user-agent': 'vocion-personal' },
    body: JSON.stringify({ client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token || body.error) {
    throw new Error('GitHub would not renew your login. Connect GitHub again from Personal connectors.');
  }
  const renewed = { ...values, token: body.access_token, refreshToken: body.refresh_token ?? refreshToken, expiresAt: grantExpiresAt(body.expires_in, 8 * 3600) };
  // Lost the race: another turn renewed first, and its token is as good as ours for this call.
  await updateLoginCredentialValues({ orgId: input.orgId, tokenId: input.tokenId, values: renewed, expectedRefreshToken: refreshToken });
  return body.access_token;
}

async function githubJson<T>(token: string, what: string, path: string): Promise<T> {
  const res = await fetch(`${GITHUB_API_URL}${path}`, { headers: { ...HEADERS, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new GithubCallError(what, res.status);
  }
  return (await res.json()) as T;
}

type SearchItem = { title: string; html_url: string; number: number; repository_url: string; updated_at: string; pull_request?: unknown; user?: { login?: string } };

/** One thing on the person. */
export type GithubItem = { title: string; ref: string; url: string; updated: string; kind: 'pull' | 'issue'; author: string | null };

function itemOf(i: SearchItem): GithubItem {
  const repo = i.repository_url.replace(/^.*\/repos\//, '');
  return { title: i.title, ref: `${repo}#${i.number}`, url: i.html_url, updated: i.updated_at, kind: i.pull_request ? 'pull' : 'issue', author: i.user?.login ?? null };
}

/** What is on the person, in three lists. */
export type GithubWork = { reviewRequested: GithubItem[]; authoredPulls: GithubItem[]; assignedIssues: GithubItem[] };

/**
 * What is on the person across every repository their token can see: reviews
 * asked of them, their own open pull requests, and open issues assigned to them.
 * @param token - Their user token.
 */
export async function githubMyWork(token: string): Promise<GithubWork> {
  const search = (q: string) => githubJson<{ items?: SearchItem[] }>(token, 'the search', `/search/issues?${new URLSearchParams({ q, sort: 'updated', order: 'desc', per_page: '15' })}`)
    .then(r => (r.items ?? []).map(itemOf));
  const [reviewRequested, authoredPulls, assignedIssues] = await Promise.all([
    search('is:open is:pr review-requested:@me archived:false'),
    search('is:open is:pr author:@me archived:false'),
    search('is:open is:issue assignee:@me archived:false'),
  ]);
  return { reviewRequested, authoredPulls, assignedIssues };
}

/** One issue or pull request, read in full. */
export type GithubThread = { title: string; ref: string; url: string; state: string; kind: 'pull' | 'issue'; author: string | null; body: string; comments: Array<{ author: string | null; at: string; body: string }> };

/**
 * Parse `owner/repo#123` or a github.com issue or pull request URL.
 * @param ref - What the person or the model named.
 */
export function parseGithubRef(ref: string): { owner: string; repo: string; number: number } | null {
  const short = ref.trim().match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  const long = ref.trim().match(/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)/);
  const m = short ?? long;
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null;
}

/**
 * Read one issue or pull request with its latest comments.
 * @param token - Their user token.
 * @param ref - The parsed reference.
 * @param ref.owner - Owner.
 * @param ref.repo - Repository.
 * @param ref.number - Issue or pull request number.
 */
export async function githubRead(token: string, ref: { owner: string; repo: string; number: number }): Promise<GithubThread> {
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues/${ref.number}`;
  const issue = await githubJson<{ title: string; html_url: string; state: string; body?: string | null; pull_request?: unknown; user?: { login?: string } }>(token, 'the issue', base);
  const comments = await githubJson<Array<{ user?: { login?: string }; created_at: string; body?: string }>>(token, 'its comments', `${base}/comments?per_page=100`);
  return {
    title: issue.title,
    ref: `${ref.owner}/${ref.repo}#${ref.number}`,
    url: issue.html_url,
    state: issue.state,
    kind: issue.pull_request ? 'pull' : 'issue',
    author: issue.user?.login ?? null,
    body: (issue.body ?? '').slice(0, 8000),
    // Oldest first from GitHub; the latest ten are what the turn needs.
    comments: comments.slice(-10).map(c => ({ author: c.user?.login ?? null, at: c.created_at, body: (c.body ?? '').slice(0, 1500) })),
  };
}
