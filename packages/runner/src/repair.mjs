// In-run repair: when the required checks fail on the engineer's work, the same engineer gets the
// failures back and fixes them inside this run, instead of the run failing and the factory paying a
// whole new attempt (dispatch, clone, npm ci, context, checks, QA: about 10 minutes and $2 each;
// FE-364, FE-370, FE-130 and FE-224 each lost one or more attempts to a red `test`, 2026-10-02).
//
// Pure: main() in runner.mjs asks repairDecision whether to run a pass, renders the brief with
// repairBrief, and records each pass with repairRecord.

/** At most this many repair passes per run; the checks re-run after each. */
export const MAX_REPAIR_PASSES = 2;
/** A repair pass needs at least this long on the clock, beyond the checks it re-runs. */
export const MIN_REPAIR_SECONDS = 180;
/** And at least this much budget, or it would stop before it could fix anything. */
export const MIN_REPAIR_BUDGET_USD = 0.25;

// The shell's "cannot execute" and "not found": the check's command is configuration, not code
// (check_not_runnable, #1048), and nothing the engineer changes makes it run.
const NOT_RUNNABLE_EXIT = new Set([126, 127]);

/**
 * Whether a failed check is the engineer's to fix. A check that cannot run is the repo record's.
 * @param {{ status: string, exit_code?: number|null, not_runnable?: boolean }} check
 */
export function isRepairable(check) {
  return check?.status === 'failed' && !check.not_runnable && !NOT_RUNNABLE_EXIT.has(Number(check.exit_code));
}

/**
 * Whether to send the failures back to the engineer for another pass, and why not when not.
 * @param {object} p
 * @param {{ ok: boolean, noChanges?: boolean, checks: Array<object> }} p.verification the last verify()
 * @param {number} p.passesDone repair passes already run in this run
 * @param {number} [p.maxPasses]
 * @param {number} p.budgetLeftUsd what the run may still spend on the model
 * @param {number} p.secondsLeft wall clock left for the model, after the land reserve and the re-run checks
 * @param {boolean} [p.stopped] a stop or cancel arrived (a person's cancel is final, #1038)
 * @param {boolean} [p.lostLease]
 * @returns {{ repair: boolean, reason: string, failures: Array<object> }}
 */
export function repairDecision({ verification, passesDone, maxPasses = MAX_REPAIR_PASSES, budgetLeftUsd, secondsLeft, stopped = false, lostLease = false }) {
  const failed = (verification?.checks || []).filter(c => c.status === 'failed');
  const failures = failed.filter(isRepairable);
  const no = reason => ({ repair: false, reason, failures });
  if (!verification || verification.ok) {
    return no('passed');
  }
  if (verification.noChanges) {
    return no('no-changes');
  }
  if (!failed.length) {
    return no('not-a-check'); // e.g. a change to a file a person owns: not a check to repair
  }
  if (failures.length < failed.length) {
    return no('not-runnable');
  }
  if (stopped || lostLease) {
    return no('stopped');
  }
  if (passesDone >= maxPasses) {
    return no('passes-exhausted');
  }
  if (!(budgetLeftUsd >= MIN_REPAIR_BUDGET_USD)) {
    return no('budget');
  }
  if (!(secondsLeft >= MIN_REPAIR_SECONDS)) {
    return no('wall-clock');
  }
  return { repair: true, reason: 'checks-failed', failures };
}

function tailOf(text, lines = 60) {
  return String(text || '').trim().split('\n').slice(-lines).join('\n').slice(-6000);
}

/**
 * The brief for one repair pass: each failing check's name, command and the tail of its output.
 * @param {object} p
 * @param {Array<{ name: string, command?: string, exit_code?: number|null, tail?: string }>} p.failures
 * @param {Record<string, string>} [p.outputs] each command check's full output, by name
 * @param {number} p.pass 1-based
 * @param {number} [p.maxPasses]
 * @param {string} [p.taskBrief] the original task markdown, for a pass that is not a resumed session
 */
export function repairBrief({ failures, outputs = {}, pass, maxPasses = MAX_REPAIR_PASSES, taskBrief = '' }) {
  const blocks = failures.map((c) => {
    const out = tailOf(outputs[c.name] || c.tail || '');
    return [
      `### ${c.name}`,
      '',
      c.command ? `Command: \`${c.command}\` (exit ${c.exit_code ?? 'n/a'})` : `A check built into the worker (exit ${c.exit_code ?? 'n/a'}).`,
      '',
      '```',
      out || '(no output)',
      '```',
    ].join('\n');
  });
  return [
    taskBrief ? `${taskBrief}\n\n---\n` : '',
    `# Repair pass ${pass} of ${maxPasses}: required checks failed`,
    '',
    taskBrief
      ? 'An earlier pass on this task left its changes in the working tree (see `git status` and `git diff`). The worker then ran the required checks, and these failed.'
      : 'The worker ran the required checks on the changes you left, and these failed.',
    '',
    blocks.join('\n\n'),
    '',
    '## What to do',
    '',
    '- Find the cause and fix it in the code. Do not weaken, skip or delete a test or a check to make it pass.',
    '- Run each failing command above yourself until it passes, then run the other required checks again so the fix breaks nothing else.',
    '- Leave the changes in the working tree. Do not commit or push.',
    '- Finish with a short plain-text report: what failed, what you changed, and the command output that shows it passing now.',
    '',
    'The worker runs every required check again after you finish.',
  ].filter(l => l !== '').join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * One repair pass as the run's result records it: which checks failed going in, which the pass
 * fixed, which still fail, and what it cost.
 */
export function repairRecord({ pass, failures, after, resumed, costUsd = 0, durationS = 0, outcome }) {
  const before = failures.map(c => c.name);
  const stillFailing = (after?.checks || []).filter(c => c.status === 'failed').map(c => c.name);
  const fixed = before.filter(n => !stillFailing.includes(n));
  const newlyFailing = stillFailing.filter(n => !before.includes(n));
  const resolved = outcome || (after?.ok ? 'fixed' : (after ? 'still-failing' : 'not-verified'));
  return {
    pass,
    failed: before,
    fixed: after ? fixed : [],
    still_failing: stillFailing,
    ...(newlyFailing.length ? { newly_failing: newlyFailing } : {}),
    outcome: resolved,
    resumed_session: Boolean(resumed),
    cost_usd: Math.round((Number(costUsd) || 0) * 100) / 100,
    duration_s: Math.round(Number(durationS) || 0),
  };
}

/** One line for a summary or a PR: "repaired in-run: test fixed on pass 1". */
export function repairsLine(repairs) {
  if (!repairs?.length) {
    return '';
  }
  return repairs.map(r => `pass ${r.pass}: ${r.failed.join(', ')} failed; ${r.outcome === 'fixed' ? 'all fixed' : `${r.fixed.length ? `fixed ${r.fixed.join(', ')}; ` : ''}${r.still_failing.length ? `still failing ${r.still_failing.join(', ')}` : r.outcome}`}`).join('. ');
}
