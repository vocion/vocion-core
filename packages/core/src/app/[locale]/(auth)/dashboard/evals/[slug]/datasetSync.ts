/**
 * What the dataset page says about where its cases actually live.
 *
 * Two copies of an eval exist once a grader holds its own dataset: the one in
 * the workspace file, which a person edits, and the one in the grader's
 * account, which a run publishes. They drift. Someone reading a score needs to
 * know which cases produced it, and someone debugging a run needs the grader's
 * own id for the dataset so they can find it in the AWS console.
 *
 * The rules are kept out of the page so they can be tested, and they are all
 * about not overstating what we know:
 *
 * - A grader that keeps no dataset of its own says so, instead of showing an
 *   empty "not synced" state that will never fill in.
 * - Nothing published yet is "not copied yet", not an error — the first run
 *   publishes.
 * - A failed copy says so plainly, and says the run still went ahead, because
 *   scores from a run whose publish failed are still real scores.
 * - Edited cases that have not been published yet say the copy is behind,
 *   rather than quietly showing a version number that measures other cases.
 */

import type { DatasetSyncState } from '@/services/evals/publish';

/** How strongly the page should draw the state. */
export type DatasetSyncTone = 'local' | 'pending' | 'behind' | 'in-step' | 'failed';

/** The dataset sync panel, worked out. */
export type DatasetSyncSummary = {
  tone: DatasetSyncTone;
  /** The one line someone reads first. */
  headline: string;
  /** The sentence under it, saying what happens next. */
  detail: string;
  /** The grader's own id for the dataset, for support and the AWS console. */
  remoteId: string | null;
  /** The version the grader is holding, when it is holding one. */
  remoteVersion: string | null;
  /** When we last tried to publish, for the page to format. */
  syncedAt: Date | null;
};

/** What the page knows when it asks. */
export type DatasetSyncFacts = {
  /** What to call the grader, e.g. "AgentCore". */
  graderLabel: string;
  /** True when this grader keeps a copy of the cases in its own account. */
  keepsDataset: boolean;
  /** The workspace file's version of this dataset. */
  workspaceVersion: number;
  /** The row for this dataset and grader, or null when there is none yet. */
  state: DatasetSyncState | null;
};

/**
 * Sum up where a dataset's cases stand with its grader.
 * @param facts - The grader, the workspace version, and the publish row.
 */
export function summariseDatasetSync(facts: DatasetSyncFacts): DatasetSyncSummary {
  if (!facts.keepsDataset) {
    return {
      tone: 'local',
      headline: `Defined in your workspace file, stored in Vocion (v${facts.workspaceVersion})`,
      detail: `${facts.graderLabel} reads the cases straight from Vocion, so there is no second copy to keep in step.`,
      remoteId: null,
      remoteVersion: null,
      syncedAt: null,
    };
  }

  const state = facts.state;
  if (!state || (!state.remoteId && !state.syncError)) {
    return {
      tone: 'pending',
      headline: `Not copied to ${facts.graderLabel} yet`,
      detail: `The next run copies these cases into your ${facts.graderLabel} account as a dataset of its own, and keeps it up to date from then on.`,
      remoteId: null,
      remoteVersion: null,
      syncedAt: state?.syncedAt ?? null,
    };
  }

  if (state.syncError) {
    return {
      tone: 'failed',
      headline: `Could not copy these cases to ${facts.graderLabel}`,
      // Worth saying out loud: a failed copy is not a failed measurement. The
      // run sends each case's expected answer with the case, so the scores are
      // as good as any other run's — only the copy in the grader's account is
      // stale.
      detail: `${state.syncError} Runs still go ahead and are still scored; only ${facts.graderLabel}'s own copy of the cases is out of date.`,
      remoteId: state.remoteId,
      remoteVersion: state.remoteVersion,
      syncedAt: state.syncedAt,
    };
  }

  if (state.drifted) {
    return {
      tone: 'behind',
      headline: `${facts.graderLabel}'s copy is behind this workspace`,
      detail: `Workspace v${facts.workspaceVersion} against ${facts.graderLabel} version ${state.remoteVersion ?? 'unknown'}. The cases here have been edited since the last copy; the next run publishes them.`,
      remoteId: state.remoteId,
      remoteVersion: state.remoteVersion,
      syncedAt: state.syncedAt,
    };
  }

  return {
    tone: 'in-step',
    headline: `In step with ${facts.graderLabel}`,
    detail: `Workspace v${facts.workspaceVersion} and ${facts.graderLabel} version ${state.remoteVersion ?? 'unknown'} hold the same cases.`,
    remoteId: state.remoteId,
    remoteVersion: state.remoteVersion,
    syncedAt: state.syncedAt,
  };
}
