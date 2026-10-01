/**
 * DID A DEPLOY CAUSE THIS PRODUCTION ERROR? Read from facts, never guessed
 * (Chris, 2026-10-01: a build fix shipped an API whose runtime had no
 * database engine, every signed-in call answered 500 for hours, and the error
 * tracker counted 184 of them while the deploy read "succeeded").
 *
 * The facts are the error tracker's (the release an issue was FIRST seen in,
 * and when) and the environment record's (the commit it runs, when that was
 * deployed, and the commit it was last healthy on). Releases are commits:
 * an SDK initialised with the deployed sha names its events by it.
 *
 *   last-deploy     the issue's first release IS the commit deployed here,
 *                   and it first appeared after that deploy (with a little
 *                   slack: a container takes traffic before the run reports).
 *                   Reverting that deploy's pull request takes it out.
 *   earlier-deploy  it was first seen in another release: an older change,
 *                   or one a later deploy did not fix. Not the last deploy's.
 *   unknown         the issue names no release, or the environment no deploy.
 *
 * Nothing here names a product, a vendor's project or a stage.
 */

import type { EnvironmentRow } from './environments';

type Meta = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** How long before a deploy run reports done its new release may already take traffic. */
export const DEPLOY_SLACK_MS = 15 * 60_000;

export type ErrorFacts = { shortId: string; firstRelease: string | null; firstSeen: string | null; url?: string | null };
export type DeployCause = {
  verdict: 'last-deploy' | 'earlier-deploy' | 'unknown';
  /** One line a person reads: what settled it. */
  line: string;
  deployedSha: string | null;
  deployedAt: string | null;
  firstRelease: string | null;
  firstSeen: string | null;
  /** The last commit the environment was healthy on, when recorded: what a revert goes back to. */
  healthySha: string | null;
};

/**
 * Whether two commit names are the same commit: equal, or one a prefix of the
 * other of at least seven characters (a release may be the short sha).
 * @param a - One sha.
 * @param b - The other.
 */
export function sameCommit(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) {
    return true;
  }
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 7 && /^[0-9a-f]+$/.test(short) && long.startsWith(short);
}

/**
 * The verdict for one issue on one environment.
 * @param issue - What the error tracker says.
 * @param env - The environment's metadata.
 */
export function deployCauseOf(issue: ErrorFacts, env: Meta): DeployCause {
  const deployedSha = str(env.lastDeployedSha);
  const deployedAt = str(env.lastDeployedAt);
  const base = { deployedSha, deployedAt, firstRelease: issue.firstRelease, firstSeen: issue.firstSeen, healthySha: str(env.lastHealthySha) };
  const short = (s: string | null) => s?.slice(0, 7) ?? '?';
  if (!issue.firstRelease) {
    return { ...base, verdict: 'unknown', line: `${issue.shortId} names no release, so which deploy brought it cannot be read; its events need the SDK's release set to the deployed commit.` };
  }
  if (!deployedSha) {
    return { ...base, verdict: 'unknown', line: `${issue.shortId} was first seen in release ${short(issue.firstRelease)}, and this environment records no deploy to compare it with.` };
  }
  if (!sameCommit(issue.firstRelease, deployedSha)) {
    return { ...base, verdict: 'earlier-deploy', line: `${issue.shortId} was first seen in release ${short(issue.firstRelease)}, not in ${short(deployedSha)} deployed here${deployedAt ? ` at ${deployedAt}` : ''}: the last deploy did not bring it.` };
  }
  const seen = issue.firstSeen ? Date.parse(issue.firstSeen) : Number.NaN;
  const at = deployedAt ? Date.parse(deployedAt) : Number.NaN;
  if (Number.isFinite(seen) && Number.isFinite(at) && seen < at - DEPLOY_SLACK_MS) {
    return { ...base, verdict: 'earlier-deploy', line: `${issue.shortId} carries release ${short(deployedSha)} but was first seen at ${issue.firstSeen}, before it was deployed here at ${deployedAt}: it came from somewhere else running that commit.` };
  }
  return { ...base, verdict: 'last-deploy', line: `Caused by the deploy of ${short(deployedSha)}${deployedAt ? ` at ${deployedAt}` : ''}: ${issue.shortId} was first seen in that release${issue.firstSeen ? `, at ${issue.firstSeen}` : ''}.` };
}

/**
 * The environment records that report to one error-tracking project (and,
 * when the issue names one, environment), with their deploys.
 * @param rows - Every environment.
 * @param ref - The project.
 * @param ref.org - Organization.
 * @param ref.project - Project.
 * @param ref.environment - The tracker's environment tag, when known.
 */
export async function environmentsReportingTo(rows: EnvironmentRow[], ref: { org: string; project: string; environment?: string | null }): Promise<EnvironmentRow[]> {
  const { sentryRefOf } = await import('@/libs/sentry/reference');
  return rows.filter((e) => {
    const r = sentryRefOf(e.meta);
    if (!r || r.project.toLowerCase() !== ref.project.toLowerCase() || r.org.toLowerCase() !== ref.org.toLowerCase()) {
      return false;
    }
    return !ref.environment || !r.environment || r.environment.toLowerCase() === ref.environment.toLowerCase();
  });
}

/** What `sentry_issue` adds to an issue: the environment, the verdict and the pull request behind the release. */
export type DeployCorrelation = DeployCause & {
  environment: { id: number; slug: string; repo: string | null; lastDeployRunUrl: string | null } | null;
  /** The merged pull request the first release came from, when it was merged through one. */
  pull: string | null;
};

/**
 * Correlate an issue with the environment it was reported from and its deploys.
 * @param orgId - The workspace.
 * @param issue - The issue's facts.
 * @param ref - Where it was reported.
 * @param ref.org - Organization.
 * @param ref.project - Project.
 * @param ref.environment - Environment tag.
 * @param deps - Injected in tests.
 * @param deps.rows - The environments.
 * @param deps.mergedPullFor - Which pull request a commit came from.
 */
export async function correlateIssue(orgId: string, issue: ErrorFacts, ref: { org: string; project: string; environment?: string | null }, deps: { rows?: EnvironmentRow[]; mergedPullFor?: (orgId: string, repo: string, sha: string) => Promise<string | null> } = {}): Promise<DeployCorrelation> {
  const rows = deps.rows ?? await (await import('./environments')).environmentRows(orgId);
  const envs = await environmentsReportingTo(rows, ref);
  const env = envs.find(e => str(e.meta.stage) === 'production') ?? envs[0] ?? null;
  if (!env) {
    return { verdict: 'unknown', line: `No environment record names ${ref.org}/${ref.project}${ref.environment ? ` (${ref.environment})` : ''} as its error tracking, so the deploy behind ${issue.shortId} cannot be read.`, deployedSha: null, deployedAt: null, firstRelease: issue.firstRelease, firstSeen: issue.firstSeen, healthySha: null, environment: null, pull: null };
  }
  const cause = deployCauseOf(issue, env.meta);
  let pull: string | null = null;
  if (env.repo && issue.firstRelease && /^[0-9a-f]{7,40}$/i.test(issue.firstRelease)) {
    const find = deps.mergedPullFor ?? (await import('./githubChecks')).mergedPullFor;
    pull = await find(orgId, env.repo, issue.firstRelease).catch(() => null);
  }
  return { ...cause, environment: { id: env.id, slug: str(env.meta.slug) ?? env.title, repo: env.repo, lastDeployRunUrl: str(env.meta.lastDeployRunUrl) }, pull };
}
