/**
 * WHAT A CHECK SAW — the typed result a monitor's run writes on its
 * `automation_run.result.check` (Chris, 2026-10-02, of the Incidents page:
 * "How can I see what monitors/tests are configured and enabled? Log of checks
 * with results?"). Before this, a watch that read three Sentry projects and
 * found nothing stored `{"acted": []}`, which cannot tell a quiet production
 * from a watch that read nothing.
 *
 * Every pass names each target it checked, what it observed there, the
 * threshold it compared against, and one outcome: `quiet`, an incident
 * `opened`, one `updated` (spiking, reopened, resolved, recovering), or
 * `unchecked` with why. A target's `label` comes from the automation's own
 * config or the records it reads, never from core: nothing here names a
 * project, a product or a job.
 */

export const CHECK_OUTCOMES = ['quiet', 'opened', 'updated', 'unchecked'] as const;
export type CheckOutcome = typeof CHECK_OUTCOMES[number];

/** One target a pass checked. */
export type CheckTarget = {
  /** What was checked, as the config names it: a project slug, a host. */
  label: string;
  outcome: CheckOutcome;
  /** What was seen, in a few words: "0 issues in the last hour", "200 in 312 ms". */
  summary: string;
  /** The observation itself, as typed fields the detail shows (counts, status, latency, the newest issue). */
  observed: Record<string, unknown>;
  /** Why it could not be checked, when `outcome` is `unchecked`. */
  why?: string;
  /** The record the pass opened or updated, when it did. */
  recordId?: number | null;
  /** Where a person sees it for themselves: the issue, the URL read. */
  url?: string | null;
};

/** One pass of a monitor. */
export type CheckResult = {
  /** What kind of read this was, in words the page shows ("Sentry issues", "HTTP health"). */
  kind: string;
  /** The threshold each target is compared against, in words. */
  threshold: string;
  outcome: CheckOutcome;
  targets: CheckTarget[];
  /** Why the whole pass could not check, when it could not. */
  why?: string;
  at: string;
};

const RANK: Record<CheckOutcome, number> = { opened: 3, updated: 2, unchecked: 1, quiet: 0 };

/**
 * The pass's outcome from its targets: an incident opened outranks an update,
 * which outranks a target that could not be read, which outranks quiet. No
 * target at all is `unchecked`: a pass that read nothing did not check.
 * @param targets - What the pass checked.
 */
export function passOutcome(targets: ReadonlyArray<{ outcome: CheckOutcome }>): CheckOutcome {
  if (targets.length === 0) {
    return 'unchecked';
  }
  return targets.reduce<CheckOutcome>((best, t) => (RANK[t.outcome] > RANK[best] ? t.outcome : best), 'quiet');
}

/**
 * A pass, assembled.
 * @param o - Its parts; `outcome` is derived unless the whole pass could not check.
 * @param o.kind
 * @param o.threshold
 * @param o.targets
 * @param o.why - Set when the pass could not check at all.
 * @param o.at
 */
export function checkResult(o: { kind: string; threshold: string; targets: CheckTarget[]; why?: string; at: Date }): CheckResult {
  return {
    kind: o.kind,
    threshold: o.threshold,
    outcome: o.why ? 'unchecked' : passOutcome(o.targets),
    targets: o.targets,
    ...(o.why ? { why: o.why } : {}),
    at: o.at.toISOString(),
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * A stored run's check, or null when it recorded none (a run from before
 * checks recorded what they saw, or a job that is not a monitor). Tolerant of
 * what is stored: a field that does not parse is dropped, never thrown.
 * @param result - `automation_run.result`.
 */
export function readCheckResult(result: unknown): CheckResult | null {
  const c = result && typeof result === 'object' ? (result as Record<string, unknown>).check : null;
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return null;
  }
  const o = c as Record<string, unknown>;
  const outcome = (CHECK_OUTCOMES as readonly string[]).includes(String(o.outcome)) ? o.outcome as CheckOutcome : null;
  if (!outcome) {
    return null;
  }
  const targets = (Array.isArray(o.targets) ? o.targets : []).flatMap((t): CheckTarget[] => {
    const x = t && typeof t === 'object' ? t as Record<string, unknown> : null;
    const label = str(x?.label);
    const tOutcome = (CHECK_OUTCOMES as readonly string[]).includes(String(x?.outcome)) ? x!.outcome as CheckOutcome : null;
    if (!x || !label || !tOutcome) {
      return [];
    }
    return [{
      label,
      outcome: tOutcome,
      summary: str(x.summary) ?? '',
      observed: x.observed && typeof x.observed === 'object' && !Array.isArray(x.observed) ? x.observed as Record<string, unknown> : {},
      ...(str(x.why) ? { why: str(x.why)! } : {}),
      ...(typeof x.recordId === 'number' ? { recordId: x.recordId } : {}),
      ...(str(x.url) ? { url: str(x.url) } : {}),
    }];
  });
  return {
    kind: str(o.kind) ?? 'Check',
    threshold: str(o.threshold) ?? '',
    outcome,
    targets,
    ...(str(o.why) ? { why: str(o.why)! } : {}),
    at: str(o.at) ?? '',
  };
}

/** The outcome in words, as a row's badge says it. */
export const OUTCOME_LABEL: Record<CheckOutcome, string> = {
  quiet: 'Quiet',
  opened: 'Incident opened',
  updated: 'Incident updated',
  unchecked: 'Could not check',
};

/**
 * The pass in one line: each target with what it saw ("send-api: 0 issues in
 * the last hour · send-web: …"), or why it could not check.
 * @param c - The pass.
 */
export function checkLine(c: CheckResult): string {
  if (c.why) {
    return `Could not check: ${c.why}`;
  }
  if (c.targets.length === 0) {
    return 'Nothing to check';
  }
  return c.targets.map(t => `${t.label}: ${t.outcome === 'unchecked' ? `could not check${t.why ? ` (${t.why})` : ''}` : t.summary}`).join(' · ');
}

/**
 * A list of labels as a sentence: "a", "a and b", "a, b and c".
 * @param items - The labels.
 */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? '';
  }
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
