/**
 * AFTER THE MERGE, WHAT IS CARRYING IT (Chris, 2026-09-30, on #269: "the
 * active state is merged … I'd expect to see a release agent running on this
 * or QA agent running or something because it's merged. Something should be
 * watching and go to prod … I'm kind of stuck here, not knowing if it is
 * going, or what's watching it").
 *
 * He merged PR #141 at 22:38:05; GitHub's deploy workflow started a second
 * later and was still running at 22:45. Vocion heard `pr.merged`, and the
 * request went on reading "building" with a recovery line from the morning,
 * because nothing wrote the merge onto the request and nothing read the runs
 * the merge started.
 *
 * `request.metadata.delivery` is that record: who merged which pull request
 * when, and the GitHub Actions runs on the merge commit, read back until they
 * finish (`services/factory/delivery.ts` writes it on `pr.merged` and the
 * five-minute reconcile keeps it current). This module reads it — pure and
 * client-safe, so the feature page, the Now line and the Work row say the same.
 *
 * Nothing here names a workflow: which run deploys is the repository's
 * business, so every run on the merge commit is shown by its own name.
 */

/** One GitHub Actions run on the merge commit, as the page shows it. */
export type DeliveryRun = {
  runId: number;
  /** The workflow's own name ("Deploy"), as GitHub gives it. */
  name: string | null;
  runNumber: number | null;
  url: string;
  /** `queued`, `in_progress`, `completed`, … as GitHub says. */
  status: string | null;
  /** `success`, `failure`, … once completed. */
  conclusion: string | null;
  /** ISO — when it started. */
  startedAt: string | null;
};

/** `request.metadata.delivery`. */
export type Delivery = {
  prUrl: string;
  /** "PR #141". */
  pr: string | null;
  repo: string | null;
  /** ISO — when it merged. */
  mergedAt: string;
  /** Who merged it: a person's name when Vocion knows them, else GitHub's login. */
  mergedBy: string | null;
  mergeSha: string | null;
  /** The runs on the merge commit, newest first. Empty until they are read. */
  runs: DeliveryRun[];
  /** ISO — when the runs were last read from GitHub; null when they never were. */
  runsReadAt: string | null;
};

/** Where the runs on the merge stand. */
export type DeliveryStage = 'deploying' | 'deployed' | 'failed' | 'unread';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The delivery a request carries, or null.
 * @param meta - The request's metadata.
 */
export function readDelivery(meta: Record<string, unknown> | null | undefined): Delivery | null {
  const raw = meta?.delivery;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const d = raw as Record<string, unknown>;
  const prUrl = str(d.prUrl);
  const mergedAt = str(d.mergedAt);
  if (!prUrl || !mergedAt) {
    return null;
  }
  const runs = (Array.isArray(d.runs) ? d.runs : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(r => ({
      runId: Number(r.runId),
      name: str(r.name),
      runNumber: Number.isInteger(Number(r.runNumber)) ? Number(r.runNumber) : null,
      url: str(r.url) ?? '',
      status: str(r.status),
      conclusion: str(r.conclusion),
      startedAt: str(r.startedAt),
    }))
    .filter(r => Number.isInteger(r.runId) && r.runId > 0);
  return { prUrl, pr: str(d.pr), repo: str(d.repo), mergedAt, mergedBy: str(d.mergedBy), mergeSha: str(d.mergeSha), runs, runsReadAt: str(d.runsReadAt) };
}

/** Conclusions that are not a failure of the work (a run nobody needed, or one superseded). */
const NOT_FAILED: ReadonlySet<string> = new Set(['success', 'skipped', 'neutral', 'cancelled']);

/**
 * Where the runs on the merge stand: still going, all finished well, one
 * failed, or not read yet.
 * @param d - The delivery.
 */
export function deliveryStage(d: Delivery): DeliveryStage {
  if (d.runs.length === 0) {
    return 'unread';
  }
  if (d.runs.some(r => r.status !== 'completed')) {
    return 'deploying';
  }
  return d.runs.every(r => NOT_FAILED.has(r.conclusion ?? '')) ? 'deployed' : 'failed';
}

/**
 * The run carrying it now: the oldest still going (the one that started with
 * the merge), else null.
 * @param d - The delivery.
 */
export function runningRun(d: Delivery): DeliveryRun | null {
  const going = d.runs.filter(r => r.status !== 'completed');
  return [...going].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))[0] ?? null;
}

/**
 * "Deploy run #512", "Run #36786695048" — a run by its own name.
 * @param r - The run.
 */
export function runName(r: DeliveryRun): string {
  return `${r.name ?? 'GitHub Actions'} run #${r.runNumber ?? r.runId}`;
}

/**
 * The GitHub runs worth keeping for a merge: the ones on the merge commit,
 * newest first, at most five. A pure pick over what the API listed.
 * @param runs - The workflow runs GitHub listed for the commit.
 * @param runs[].id - The run id.
 * @param runs[].name - The workflow name.
 * @param runs[].run_number - Its number.
 * @param runs[].html_url - Its page.
 * @param runs[].status - Its status.
 * @param runs[].conclusion - Its conclusion.
 * @param runs[].run_started_at - When it started.
 * @param runs[].created_at - When it was created.
 * @param runs[].head_sha - The commit it ran on.
 * @param sha - The merge commit.
 */
export function deliveryRunsOf(runs: ReadonlyArray<{ id: number; name?: string | null; run_number?: number | null; html_url: string; status?: string | null; conclusion?: string | null; run_started_at?: string | null; created_at?: string | null; head_sha?: string | null }>, sha: string): DeliveryRun[] {
  return runs
    .filter(r => !r.head_sha || r.head_sha === sha)
    .map(r => ({ runId: r.id, name: r.name ?? null, runNumber: r.run_number ?? null, url: r.html_url, status: r.status ?? null, conclusion: r.conclusion ?? null, startedAt: r.run_started_at ?? r.created_at ?? null }))
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
    .slice(0, 5);
}
