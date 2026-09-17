/**
 * One sync's spending limits, shared by every processor invocation in it.
 *
 * The caps are per SYNC, not per document. A per-document counter would be
 * eight times looser than it reads, because `runSync` keeps up to
 * `MAX_CONCURRENT_INGESTS` documents in flight at once, eight documents each
 * "allowed one model call" is eight calls, every time.
 *
 * Two rules the whole design leans on:
 *
 *   - **A slot is taken before the work is awaited.** Deciding after the call
 *     returns is not a cap: eight concurrent documents would all see the same
 *     unspent budget and all spend it.
 *   - **A manifest may only LOWER a cap.** The code defaults are the ceiling a
 *     tenant cannot raise by editing YAML, so the worst case of a bad manifest
 *     is a cheaper run than intended, never a more expensive one.
 *
 * Nothing here throws. A spent budget is a reason to skip work, not a reason
 * to fail a sync that has already ingested documents successfully.
 */

/** The caps one sync runs under. Every value is a maximum. */
export type SyncBudgetCaps = {
  /** Pages a processor may fetch across the whole sync. */
  maxPages: number;
  /** Detail-page hops (a ticket page named by a record) across the whole sync. */
  maxDetailHops: number;
  /** Model calls across the whole sync. */
  maxModelCalls: number;
  /** Input tokens one model call may carry, enforced by truncation. */
  maxInputTokensPerCall: number;
  /** Milliseconds one model call may take before it is abandoned. */
  modelTimeoutMs: number;
  /** Input tokens the whole sync may send. */
  maxInputTokensPerSync: number;
  /** Proposals the whole sync may write. */
  maxProposalsPerSync: number;
  /** Wall-clock milliseconds the processor side of a sync may span. */
  maxWallClockMs: number;
};

/**
 * The ceilings. A manifest's `limits` block may lower any of these and can
 * never raise one, see `createSyncBudget`.
 *
 * `maxModelCalls` is 150 and `maxInputTokensPerSync` is 800,000, and both are
 * sized for ONE CALL PER DOCUMENT, because a document is now one feed entry or
 * one detail page rather than one listing page. 25 and 120,000 came from the
 * agent run that motivated this pipeline, which spent 26 calls on five listing
 * pages, and the second dev shadow (2026-09-15, three Larkfield sources) showed
 * what that costs at the new granularity: Ashby Library crawled 59 detail
 * pages, spent all 25 calls, hit a cap 34 times and SKIPPED 44 documents, and
 * Mill Creek skipped 1 of its 26. The same run measured what a call actually
 * carries: 51 Bedrock invocations, 169,831 input tokens, 3,330 average, 6,150
 * at the worst, well under the 10,000-token per-call ceiling.
 *
 * The token cap was 400,000 on those averages, which read as 150 calls at
 * about 2,700 each. The fourth dev shadow (2026-09-16, Bellwater Hall) showed
 * that the two caps are not the same size in practice: 117 documents, about
 * 4,500 input tokens for a detail page rather than 2,700, so the sync spent
 * its tokens after 88 of its 150 calls and left 29 documents unread. 800,000
 * is that same 150 calls at the measured 4,500, which puts the token cap back
 * behind the call cap where it belongs: the call cap is the one meant to stop
 * a runaway source, and a sync should end because it ran out of PAGES, not
 * because a long first sweep of a venue was cut in the middle. The ceiling
 * only pays for a first sweep in any case, a steady-state sync re-reads just
 * the pages that changed.
 *
 * `modelTimeoutMs` is 60,000 because it was 20,000 and that number came from
 * nowhere: the first dev shadow of this pipeline (2026-09-15) measured six
 * Bedrock calls averaging 18.2s and topping out at 19.8s, none of which
 * failed, and ALL of which were cut off by the 20s deadline. A cap set below
 * what a healthy call costs is not a cap, it is a guaranteed failure, and it
 * costs the retry and then the whole document.
 */
export const SYNC_BUDGET_DEFAULTS: SyncBudgetCaps = {
  maxPages: 60,
  maxDetailHops: 40,
  maxModelCalls: 150,
  maxInputTokensPerCall: 10_000,
  modelTimeoutMs: 60_000,
  maxInputTokensPerSync: 800_000,
  maxProposalsPerSync: 120,
  maxWallClockMs: 600_000,
};

/**
 * The caps that count something up. `maxInputTokensPerCall` is a truncation
 * budget rather than a tally, and `modelTimeoutMs` and `maxWallClockMs` are
 * time, all three are read off `caps` directly.
 */
export type CountedCap = 'maxPages' | 'maxDetailHops' | 'maxModelCalls' | 'maxInputTokensPerSync' | 'maxProposalsPerSync';

/**
 * A manifest's `limits` block, as stored. Values are `unknown` because the
 * blob comes back from the database: the budget checks each one itself rather
 * than trusting the row.
 */
export type SyncBudgetLimits = Partial<Record<keyof SyncBudgetCaps, unknown>>;

/** The name of any cap a run can hit, including the two that are not tallies. */
export type SyncBudgetCap = CountedCap | 'maxWallClockMs';

export type SyncBudget = {
  /** The caps in force for this run, after the manifest's lowering. */
  readonly caps: Readonly<SyncBudgetCaps>;
  /**
   * Claim `units` against one cap BEFORE starting the work it pays for.
   * Returns true when the slot was granted. A refusal is reported through
   * `onCapHit` once per call, so callers only have to obey the answer.
   */
  take: (cap: CountedCap, units?: number) => boolean;
  /**
   * Whether this run has been going longer than `maxWallClockMs`. Reported
   * through `onCapHit` the same way a refused slot is.
   */
  outOfTime: () => boolean;
  /** What has been spent so far, for the run's counters. */
  readonly spent: Readonly<Record<CountedCap, number>>;
};

/**
 * Build the budget for one sync.
 * @param opts - How this run's budget differs from the defaults.
 * @param opts.limits - A manifest's `limits` block. Each value may only lower
 * the matching default; anything higher (or not a finite number) is ignored.
 * @param opts.onCapHit - Called every time a cap refuses, with the cap's name.
 * The caller decides what a hit means for its counters and failure list.
 * @param opts.now - Clock, so a test can hit the wall-clock cap without waiting.
 */
export function createSyncBudget(opts: {
  limits?: SyncBudgetLimits;
  onCapHit?: (cap: SyncBudgetCap) => void;
  now?: () => number;
} = {}): SyncBudget {
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const caps = { ...SYNC_BUDGET_DEFAULTS };
  for (const key of Object.keys(caps) as Array<keyof SyncBudgetCaps>) {
    const authored = opts.limits?.[key];
    if (typeof authored === 'number' && Number.isFinite(authored) && authored >= 0) {
      // Math.min, never assignment: a manifest asking for MORE gets the default.
      caps[key] = Math.min(caps[key], authored);
    }
  }

  const spent: Record<CountedCap, number> = {
    maxPages: 0,
    maxDetailHops: 0,
    maxModelCalls: 0,
    maxInputTokensPerSync: 0,
    maxProposalsPerSync: 0,
  };

  return {
    caps,
    spent,
    take: (cap: CountedCap, units = 1): boolean => {
      if (spent[cap] + units > caps[cap]) {
        opts.onCapHit?.(cap);
        return false;
      }
      spent[cap] += units;
      return true;
    },
    outOfTime: (): boolean => {
      if (now() - startedAt < caps.maxWallClockMs) {
        return false;
      }
      opts.onCapHit?.('maxWallClockMs');
      return true;
    },
  };
}
