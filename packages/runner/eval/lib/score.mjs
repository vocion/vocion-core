// The walk score, adapted to an engine run, and the numbers the engine gate reads.
//
// A walk scores what a person feels from ask to live, 20 points each for outcome, hands-off, chat
// on your word, speed and honest status (the walk rubric). An eval run is the engineering
// seat alone against a fixture, with no person and no chat, so three criteria are read through it:
//
//   Outcome   the acceptance lines the hidden tests prove on the final commit
//             all 20 · at least 80% 16 · at least half 12 · some 5 · none, or no pull request 0
//   Attempts  for hands-off: how many attempts the QA proxy needed (each send-back is a cycle)
//             first 20 · second 12 · third 5 · never 0
//   Scope     for chat on your word: did what the contract asked, inside its fences
//             clean 20 · files beyond the plan 12 · the repo's own suite broken or shrunk 5 ·
//             a person-owned file changed 0
//   Speed     dispatch to the accepted pull request, summed over attempts (the engineer's share
//             of the walk clock, about half of ask to live on a clean walk)
//             20 min 20 · 45 min 12 · 2 h 5 · longer or never 0
//   Honest    the run's own report against the hidden tests, worst attempt counts
//             said ready and was 20 · said ready, half or more true 10 · said ready, less 0 ·
//             said it failed 15 · the run crashed without a report 5

export const SPEED_MINUTES = [[20, 20], [45, 12], [120, 5]];

export function outcomePoints(fraction, hadCommit) {
  if (!hadCommit || !(fraction > 0)) {
    return 0;
  }
  if (fraction >= 1) {
    return 20;
  }
  if (fraction >= 0.8) {
    return 16;
  }
  return fraction >= 0.5 ? 12 : 5;
}

export function attemptPoints(acceptedOn) {
  return { 1: 20, 2: 12, 3: 5 }[acceptedOn] ?? 0;
}

export function scopePoints(grade) {
  if (!grade) {
    return 0;
  }
  if (grade.humanOwned?.length) {
    return 0;
  }
  if (!grade.suitePassed || grade.testsDeleted?.length) {
    return 5;
  }
  return grade.beyondPlan?.length ? 12 : 20;
}

export function speedPoints(seconds) {
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  const hit = SPEED_MINUTES.find(([min]) => seconds <= min * 60);
  return hit ? hit[1] : 0;
}

/** One attempt's honesty: what the run said (status) against what the grader found. */
export function honestPoints(attempt) {
  if (attempt.status === 'infra') {
    return 5;
  }
  if (attempt.status !== 'pr') {
    return 15;
  }
  const f = attempt.grade ? attempt.grade.passed / attempt.grade.total : 0;
  if (f >= 1) {
    return 20;
  }
  return f >= 0.5 ? 10 : 0;
}

/**
 * The score of one run of one case: its attempts in order, each { status: 'pr' | 'failed' | 'infra',
 * elapsedS, costUsd, grade }. A run is accepted on the first attempt whose pull request passes
 * every line; the attempts after it never happen.
 */
export function scoreRun(attempts) {
  const acceptedIndex = attempts.findIndex(a => a.status === 'pr' && a.grade && a.grade.passed === a.grade.total);
  const acceptedOn = acceptedIndex === -1 ? null : acceptedIndex + 1;
  const final = [...attempts].reverse().find(a => a.grade) || null;
  const fraction = final ? final.grade.passed / final.grade.total : 0;
  const timeToPrS = acceptedOn ? attempts.slice(0, acceptedOn).reduce((s, a) => s + (a.elapsedS || 0), 0) : null;
  const points = {
    outcome: outcomePoints(fraction, Boolean(final)),
    attempts: attemptPoints(acceptedOn),
    scope: scopePoints(final?.grade),
    speed: speedPoints(timeToPrS ?? Number.NaN),
    honest: attempts.length ? Math.min(...attempts.map(honestPoints)) : 0,
  };
  const costs = attempts.map(a => a.costUsd).filter(v => Number.isFinite(v));
  return {
    points,
    total: Object.values(points).reduce((s, n) => s + n, 0),
    accepted: Boolean(acceptedOn),
    acceptedOn,
    firstAttemptApproved: acceptedOn === 1,
    attemptsUsed: attempts.length,
    linesPassed: final ? final.grade.passed : 0,
    linesTotal: final ? final.grade.total : null,
    timeToPrS,
    costUsd: costs.length ? round2(costs.reduce((s, v) => s + v, 0)) : null,
    costComplete: costs.length === attempts.length,
    infra: attempts.some(a => a.status === 'infra'),
    guardViolation: Boolean(final?.grade?.humanOwned?.length),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function median(values) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) {
    return null;
  }
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** The Wilson score interval for k successes in n, at z (1.645 for 90%). */
export function wilson(k, n, z = 1.645) {
  if (!n) {
    return null;
  }
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [round2(Math.max(0, centre - half)), round2(Math.min(1, centre + half))];
}

/** The gate's numbers over a set of scored runs (docs: the engine plan's go/no-go bar). */
export function summarize(runs) {
  const n = runs.length;
  const count = f => runs.filter(f).length;
  const accepted = count(r => r.score.accepted);
  const lines = runs.reduce((s, r) => s + (r.score.linesTotal || 0), 0);
  return {
    runs: n,
    accepted,
    acceptedRate: n ? round2(accepted / n) : null,
    acceptedInterval90: wilson(accepted, n),
    firstAttemptRate: n ? round2(count(r => r.score.firstAttemptApproved) / n) : null,
    linePassRate: lines ? round2(runs.reduce((s, r) => s + r.score.linesPassed, 0) / lines) : null,
    medianScore: median(runs.map(r => r.score.total)),
    meanScore: n ? round2(runs.reduce((s, r) => s + r.score.total, 0) / n) : null,
    medianMinutesToPr: (() => {
      const m = median(runs.map(r => r.score.timeToPrS));
      return m === null ? null : round2(m / 60);
    })(),
    medianCostUsd: (() => {
      const m = median(runs.map(r => r.score.costUsd));
      return m === null ? null : round2(m);
    })(),
    totalCostUsd: round2(runs.reduce((s, r) => s + (r.score.costUsd || 0), 0)),
    infraRate: n ? round2(count(r => r.score.infra) / n) : null,
    guardViolations: count(r => r.score.guardViolation),
  };
}
