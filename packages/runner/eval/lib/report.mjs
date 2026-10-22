// The results JSON and the markdown scoreboard a person reads.

const pct = v => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);
const num = v => (v === null || v === undefined ? 'n/a' : String(v));
const interval = v => (v ? `${pct(v[0])} to ${pct(v[1])}` : 'n/a');

function summaryRow(label, s) {
  return `| ${label} | ${s.runs} | ${pct(s.acceptedRate)} (${interval(s.acceptedInterval90)}) | ${pct(s.firstAttemptRate)} | ${pct(s.linePassRate)} | ${num(s.medianScore)} | ${num(s.medianMinutesToPr)} | ${s.medianCostUsd === null ? 'n/a' : `$${s.medianCostUsd}`} | ${pct(s.infraRate)} | ${s.guardViolations} |`;
}

/** The scoreboard for one eval report (runEval's return), or the blockers when it could not run. */
export function scoreboard(report, { title = 'Factory eval' } = {}) {
  if (!report.ran) {
    return [
      `# ${title}: ${report.engine} did not run`,
      '',
      'This machine lacks what the engine needs:',
      '',
      ...report.missing.map(m => `- **${m.need}**: ${m.why}`),
      '',
    ].join('\n');
  }
  const lines = [
    `# ${title}: ${report.engine}${report.label ? ` (${report.label})` : ''}`,
    '',
    ...(report.stopped ? [`**Stopped early: ${report.stopped}.**`, ''] : []),
    `${report.results.length} runs, ${report.options.runs} per case, up to ${report.options.maxAttempts} attempts each. Fixture v1 \`${report.fixture.v1.slice(0, 12)}\`, v2 \`${report.fixture.v2.slice(0, 12)}\`. ${report.startedAt} to ${report.finishedAt} (UTC).`,
    '',
    '| Set | Runs | Accepted (90% interval) | First attempt | Lines passed | Median score | Median min to PR | Median cost | Infra failures | Guard violations |',
    '|---|---|---|---|---|---|---|---|---|---|',
    summaryRow('All', report.summary.all),
    summaryRow('Tuning', report.summary.bySplit.tuning),
    summaryRow('Held out', report.summary.bySplit['held-out']),
    ...[1, 2, 3, 4].filter(cx => report.summary.byComplexity[cx].runs).map(cx => summaryRow(`Cx ${cx}`, report.summary.byComplexity[cx])),
    '',
    '| Case | Split | Cx | Risk | Run | Score | Outcome | Attempts | Scope | Speed | Honest | Lines | Accepted on | Min to PR | Cost |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...report.results.map((r) => {
      const s = r.score;
      return `| ${r.case} | ${r.split} | ${r.complexity} | ${r.risk_class} | ${r.run} | **${s.total}** | ${s.points.outcome} | ${s.points.attempts} | ${s.points.scope} | ${s.points.speed} | ${s.points.honest} | ${s.linesPassed}/${s.linesTotal ?? '?'} | ${s.acceptedOn ?? 'never'} | ${s.timeToPrS === null ? 'n/a' : Math.round(s.timeToPrS / 6) / 10} | ${s.costUsd === null ? 'n/a' : `$${s.costUsd}${s.costComplete ? '' : '+'}`} |`;
    }),
    '',
    'Score: outcome, attempts, scope, speed and honest, 20 points each (packages/runner/eval/lib/score.mjs). Lines are the acceptance lines the hidden tests proved on the final commit. A cost marked + is missing a pass killed before it reported its price.',
    '',
  ];
  return lines.join('\n');
}
