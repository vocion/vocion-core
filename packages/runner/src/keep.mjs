// Decisions for keeping failed work and resuming from a branch. Pure functions, no I/O, so
// keep.test.mjs can pin them down without git, gh or Vocion.
//
// Run 341 (a rename across an app) changed 56 files, passed typecheck, failed the `test` check and
// ended `failed` with nothing pushed: $11.86 of work gone. The rule now: when a run stops for any
// reason after Claude has changed files, the worker commits them (all but a person's files),
// pushes them as factory/<task_id>-wip-<run id>, opens a draft PR labelled checks-failed, and the
// run still ends `failed`. A later contract resumes from that branch by naming it in base_sha.

const EM_DASH = String.fromCharCode(0x2014);

export const KEEP_REASONS = {
  'checks-failed': { commit: 'checks failed, kept for review', title: 'checks failed' },
  'budget-stop': { commit: 'budget stop', title: 'budget stop' },
  'wall-clock': { commit: 'wall-clock stop', title: 'wall-clock stop' },
  'claude-exit': { commit: 'claude exited, kept for review', title: 'claude exited' },
  'stop': { commit: 'stopped by Vocion, kept for review', title: 'stopped' },
};

export function slugify(s, max = 40) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'task';
}
export function stripEmDashes(s) {
  return String(s || '').split(EM_DASH).join(',');
}

/**
 * Whether to keep the working tree. Files `allowed` accepts are kept; anything else is
 * listed so the PR body can say what was left behind. No kept files, nothing to keep.
 * @param {string[]} files changed paths (git status)
 * @param {(f: string) => boolean} allowed which files may be kept (every file but a person's)
 */
export function keepDecision(files, allowed) {
  const kept = [];
  const outside = [];
  for (const f of files || []) {
    (allowed(f) ? kept : outside).push(f);
  }
  return { keep: kept.length > 0, kept, outside };
}

/** factory/<task_id>-wip-<run id>. The run id makes it unique per attempt. */
export function wipBranchName(taskId, runId) {
  return `factory/${slugify(taskId, 48)}-wip-${slugify(String(runId), 24)}`;
}

/** The kind of stop, from what the worker knows after Claude exits. */
export function classifyStop({ stopped = false, stopReason = '', killReason = '', result = null, verificationOk = null } = {}) {
  if (stopped) {
    return stopReason === 'budget-stop' || stopReason === 'wall-clock' ? stopReason : 'stop';
  }
  if (/wall clock/i.test(killReason)) {
    return 'wall-clock';
  }
  if (!result) {
    return 'claude-exit';
  }
  if (result.is_error && /budget/i.test(String(result.subtype || ''))) {
    return 'budget-stop';
  }
  if (verificationOk === false) {
    return 'checks-failed';
  }
  if (result.is_error) {
    return 'claude-exit';
  }
  return null;
}

export function wipCommitMessage({ task, reason, runId, model }) {
  const r = KEEP_REASONS[reason] || KEEP_REASONS['checks-failed'];
  return stripEmDashes([
    `wip(${task.task_id}): ${r.commit}`,
    '',
    'Kept by the Vocion runner so the work is not lost. Not verified; review before merging.',
    '',
    `Task: ${task.task_id}${task.request_id ? ` (request ${task.request_id})` : ''}`,
    `Reason: ${reason}`,
    '',
    `Vocion-Worker-Run: ${runId}`,
    `Co-Authored-By: ${model || 'Claude'} <noreply@anthropic.com>`,
  ].join('\n'));
}

/**
 * The one sentence a commit subject and a PR title are built from: the task's own title, or, when
 * it has none, the first sentence of the objective. An objective reads as a situation report, so a
 * title derived from it names the situation instead of the change; `title` is what a planner should
 * send. Never ends in a period and never ends mid-word.
 */
export function taskHeadline(task, { max = 100 } = {}) {
  const given = typeof task?.title === 'string' ? task.title.trim() : '';
  const raw = given || String(task?.objective || '').split(/[.\n]/)[0];
  const head = stripEmDashes(String(raw).replace(/\s+/g, ' ')).trim().replace(/[.\s]+$/, '');
  if (head.length <= max) {
    return head;
  }
  const cut = head.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : head.slice(0, max)).trim().replace(/[.\s]+$/, '');
}

/** The pull request title a landed run opens: "<risk class>: <headline> (<task id>)", 120 at most. */
export function prTitle({ task, max = 120 }) {
  const prefix = `${task.risk_class}: `;
  const suffix = ` (${task.task_id})`;
  const head = taskHeadline(task, { max: Math.max(24, max - prefix.length - suffix.length) });
  return `${prefix}${head}${suffix}`.slice(0, max);
}

/** "WIP (checks failed): <headline, 60 at most> (run-<id>)". */
export function wipPrTitle({ task, objective, reason, runId }) {
  const r = KEEP_REASONS[reason] || KEEP_REASONS['checks-failed'];
  const head = taskHeadline(task || { objective }, { max: 60 });
  return `WIP (${r.title}): ${head} (run-${runId})`;
}

/** The line a planner copies into the next contract. */
export function continueLine(branch, attempt) {
  return `Continue from this branch: pass \`base_sha: ${branch}\` and \`attempt: ${Number(attempt || 1) + 1}\` in the next contract`;
}

export function wipPrBody({ task, runId, reason, branch, attempt, checks = [], verificationError = '', claude = {}, costUsd = 0, kept = [], outside = [], workerId = '', baseSha = '', resumedFrom = null }) {
  const r = KEEP_REASONS[reason] || KEEP_REASONS['checks-failed'];
  const preview = String(claude?.result?.result || claude?.stderrTail || claude?.rawTail || '(no result from claude)').trim().slice(0, 4000);
  const checkRows = checks.length
    ? checks.map(c => `| ${c.name} | ${c.status} | ${c.exit_code ?? ''} | ${c.duration_s ?? ''}s |`)
    : ['| (none ran) | | | |'];
  const tails = checks.filter(c => c.tail).map(c => [`### ${c.name} (${c.status})`, '', '```', String(c.tail).slice(-4000), '```', ''].join('\n'));
  const body = [
    `**Draft. Not verified. Kept so $${round2(costUsd)} of work is not lost.** Reason: ${r.title}${verificationError ? ` (${verificationError})` : ''}.`,
    '',
    continueLine(branch, attempt),
    '',
    '## Task contract',
    '',
    '```json',
    JSON.stringify(task, null, 2),
    '```',
    '',
    '## Check results',
    '',
    '| check | status | exit | duration |',
    '|---|---|---|---|',
    ...checkRows,
    '',
    ...tails,
    '## Files',
    '',
    `Kept, ${kept.length}:`,
    ...kept.map(f => `- \`${f}\``),
    ...(outside.length ? ['', `Left behind (a person owns these, not committed), ${outside.length}:`, ...outside.map(f => `- \`${f}\``)] : []),
    '',
    '## Claude result',
    '',
    `- exit ${claude?.code ?? '?'}${claude?.signal ? ` (${claude.signal})` : ''}, ${claude?.result?.num_turns ?? '?'} turns, ${claude?.durationS ?? '?'}s, ${claude?.result?.subtype || 'no subtype'}${claude?.result?.is_error ? ', is_error' : ''}`,
    '',
    '```',
    preview,
    '```',
    '',
    '## Run',
    '',
    `- Vocion worker run: \`${runId}\``,
    `- Worker: \`${workerId}\``,
    `- Model: \`${claude?.model || 'unknown'}\`, cost $${round2(costUsd)}`,
    `- Base: \`${baseSha}\`${resumedFrom ? ` (resumed from \`${resumedFrom.ref}\` at \`${resumedFrom.sha}\`)` : ''}`,
    `- Branch: \`${branch}\``,
    '',
    'Opened by the Vocion runner because the run did not pass. Nothing here was verified; a human decides whether to fix it forward, resume it with a new contract, or close it.',
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');
  return stripEmDashes(body);
}

// ---------- resuming from a branch ----------

/**
 * How base_sha is read. A sha is checked out detached; origin/main and main start fresh; any other
 * ref (a factory/...-wip-... branch, a feature branch) is a resume: checked out as the start of the
 * working branch and rebased on origin/main before Claude starts.
 */
export function classifyBase(base) {
  const b = String(base || '').trim();
  if (/^[0-9a-f]{7,40}$/i.test(b)) {
    return { kind: 'sha', ref: b, resume: false };
  }
  const ref = b.replace(/^origin\//, '');
  if (!ref || ref === 'main' || ref === 'HEAD') {
    return { kind: 'main', ref: 'main', resume: false };
  }
  return { kind: 'branch', ref, resume: true };
}

/** The attempt a resumed run carries: the larger of the run's and the contract's. */
export function effectiveAttempt(runAttempt, contractAttempt) {
  return Math.max(Number(runAttempt) || 1, Number(contractAttempt) || 1);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Text the worker writes itself (the commit message) carries the task's objective, which can quote a
// reviewer's note verbatim; run 368 built, passed every check and then failed to land on one such
// em dash (2026-09-26). The rule is about the repository, so the worker's own text follows it
// rather than being refused for it.
export function plainDashes(s) {
  return String(s || '').split(String.fromCharCode(0x2014)).join(' - ');
}

// The evidence goes in the pull request, where QA and a person both read first. Run 369 captured
// eleven after-shots, one per criterion, and QA still proved none: it read the task record through a
// lookup that compacts long fields, saw the first entry (a before-shot with no URL, since production
// needs a signed in session) and concluded every link was empty (2026-09-26). One line per shot here.
// `linkFor(artifactId)` gives the shot's artifact page in Vocion: ~70 characters, lasting, and the
// same link a person opens. A presigned S3 URL runs ~700 and expires in a week; seventeen of them
// pushed the evidence past what the reviewer is shown of the pull request (#131 attempt 169).
export function evidenceSection(evidence, linkFor = null) {
  const shots = (evidence || []).filter(e => e && (e.role === 'qa-screenshot' || e.role === 'qa-video'));
  if (!shots.length) {
    return [];
  }
  const lines = shots.map((e) => {
    const what = `**${e.flow}** (${e.viewport || 'desktop'}, ${e.role === 'qa-video' ? 'video' : e.side})`;
    const link = e.artifactId && linkFor ? linkFor(e.artifactId) : e.url;
    // Flagged here, not just in the caption: this is what QA reads to judge the criterion, and an
    // app error mistaken for the feature is exactly the failure this line exists to catch.
    const flag = `${e.error_state ? ' - shows an app error state, not the feature' : ''}${e.not_evidence ? ` - NOT EVIDENCE for its criterion (${e.not_evidence})` : ''}`;
    return link ? `- ${what}: ${link}${flag}` : `- ${what}: not captured${e.caption && e.caption.includes(':') ? ` (${e.caption.split(':').slice(1).join(':').trim()})` : ''}`;
  });
  return ['### Evidence', '', 'One shot per criterion a person can see, taken on this branch; open each link to check the state it names. A shot marked NOT EVIDENCE is a duplicate of another flow\'s picture or was taken after a step failed, and proves nothing for its criterion.', '', ...lines, ''];
}

/** The engineer flows the worker refused, each with its reason, for the pull request. */
export function refusedFlowsSection(refused) {
  if (!refused || !refused.length) {
    return [];
  }
  return ['### Flows the worker refused', '', 'Not shot, so these criteria have no picture from this run:', '', ...refused.map(m => `- ${m}`), ''];
}

/**
 * The pull request's list of tests that prove criteria no screenshot can show, each linked at the
 * head commit, so QA cites a test it can open instead of marking the criterion unproven.
 * @param proofs - [{ criterion, file, name }] from criterionTests.
 * @param blobFor - (relPath) => a link to the file at the head commit, or null.
 */
export function testsSection(proofs, blobFor = null, runLink = null, notRun = []) {
  const notRunLines = (notRun || []).length
    ? ['', '**Named tests that did not run, so they prove nothing:**', '', ...notRun.map(r => `- **${r.criterion}**: ${blobFor ? `[${r.file}](${blobFor(r.file)})` : r.file} › it('${r.name}') ${verdictText(r)}`), '']
    : [];
  if (!proofs || !proofs.length) {
    return notRunLines.length ? ['### Tests that prove criteria', ...notRunLines] : [];
  }
  return [
    '### Tests that prove criteria',
    '',
    runLink
      ? `For each criterion a screenshot cannot show: the test that proves it, run on this branch by itself. The output of every run: ${runLink}`
      : 'For each criterion a screenshot cannot show: the test that proves it. The suite ran in the checks above.',
    '',
    ...proofs.map(p => `- **${p.criterion}**: ${blobFor ? `[${p.file}](${blobFor(p.file)})` : p.file} › it('${p.name}')${p.passed ? ' passed' : ''}`),
    ...notRunLines,
    '',
  ];
}

/**
 * The stored output of each named test, run by itself on the branch: the proof QA opens (it runs
 * nothing itself). 2026-09-27, #131 attempt 184: QA refused named tests with "no openable CI log".
 * @param runs - [{ criterion, file, name, command, passed, output }].
 * @param runId - The worker run.
 */
export function testRunMarkdown(runs, runId) {
  const allSkipped = criteriaAllSkipped(runs);
  return [
    `# Named tests, run ${runId}`,
    '',
    'Each test that proves a criterion no screenshot can show, run by itself on this branch. The verdict is read from the named test\'s own line. The other tests in the same file are filtered out by `-t` and left out of the output below: they did not run here, and that says nothing about them.',
    '',
    ...(allSkipped.length ? ['## Criteria with no named test that ran', '', ...allSkipped.map(c => `- **${c.criterion}**: every named test was skipped (${c.reasons.join('; ')})`), ''] : []),
    ...runs.flatMap(r => [
      `## ${r.status ? statusHeading(r) : (r.passed ? 'Passed' : 'Did not pass')}: ${r.criterion}`,
      '',
      `Test: \`${r.name}\` in \`${r.file}\``,
      ...(r.line ? ['', `Its own line: \`${r.line.trim().slice(0, 300)}\``] : []),
      '',
      `\`${r.command}\``,
      '',
      '```',
      namedTestOutput(r.output, r.name).trim().split('\n').slice(-40).join('\n'),
      '```',
      '',
    ]),
  ].join('\n');
}

function statusHeading(r) {
  if (r.status === 'passed') {
    return 'Passed';
  }
  if (r.status === 'skipped') {
    return `Not run: skipped${r.reason ? ` (${r.reason})` : ''}`;
  }
  if (r.status === 'failed') {
    return 'Failed';
  }
  return 'Not run: no test by that name ran (check the name and the -t pattern)';
}

/** "passed", "not run: skipped (<reason>)", "failed", "not run: not found". */
export function verdictText(r) {
  if (r.status === 'passed' || (!r.status && r.passed)) {
    return 'passed';
  }
  if (r.status === 'skipped') {
    return `not run: skipped${r.reason ? ` (${r.reason})` : ''}`;
  }
  if (r.status === 'failed') {
    return 'failed';
  }
  return 'not run: no test by that name ran';
}

/**
 * The run's output with the file's other tests left out. Prod evidence (2026-09-29, #130 runs 409
 * and 410): every named test passed (the worker logged kept 6, passed 6), but `-t` prints each
 * sibling test in the file as "↓" skipped, eight of them under every passing test, and QA read
 * those lines as the named tests themselves being skipped. A line is kept unless it is a "↓" line
 * for a different test; one sentence says how many were filtered.
 */
export function namedTestOutput(output, name) {
  const lines = String(output || '').split('\n');
  let filtered = 0;
  const kept = lines.filter((line) => {
    if (/^\s*↓/.test(line) && !line.includes(name)) {
      filtered += 1; return false;
    }
    return true;
  });
  if (filtered) {
    kept.push(`(${filtered} other test${filtered === 1 ? '' : 's'} in this file filtered out by -t, not run here)`);
  }
  return kept.join('\n');
}

/**
 * The named test's own verdict, from its own line in the verbose output:
 * { status: 'passed' | 'failed' | 'skipped' | 'not-found', line }.
 * @param output - The verbose reporter's output.
 * @param name - The test name.
 * @param code - The exit code.
 */
export function namedTestStatus(output, name, code) {
  const candidates = String(output || '').split('\n').filter(l => l.includes(name) && /^\s*[✓√×✗↓]/.test(l));
  // A name can be the start of a longer one ("adds two" and "adds two more"): prefer the line the
  // name ends, give or take a duration or a [skipped] tag.
  const ends = l => /^(?:\d+(?:\.\d+)?\s*m?s)?(?:\s*\[[^\]]*\])?$/.test(l.slice(l.lastIndexOf(name) + name.length).trim());
  const line = candidates.find(ends) || candidates[0] || '';
  if (!line) {
    return { status: 'not-found', line: '' };
  }
  if (/^\s*↓/.test(line) || /\[?(?:skipped|todo)\]?\s*$/i.test(line)) {
    return { status: 'skipped', line };
  }
  if (/^\s*[×✗]/.test(line)) {
    return { status: 'failed', line };
  }
  return { status: code === 0 ? 'passed' : 'failed', line };
}

/**
 * Why a named test is skipped, read from its file: its own .skip / .todo / .skipIf / .runIf, or an
 * enclosing describe's, with the environment variable the condition reads when it reads one
 * (`describe.skipIf(!process.env.DATABASE_URL)`, or `const db = process.env.X` then `skipIf(!db)`).
 * '' when nothing in the file says.
 * @param source - The test file.
 * @param name - The test name.
 * @param env - The environment the test ran with, to say whether a variable was set.
 */
export function skipReason(source, name, env = {}) {
  const lines = String(source || '').split('\n');
  const at = lines.findIndex(l => l.includes(name));
  if (at === -1) {
    return '';
  }
  const indentOf = l => l.match(/^\s*/)[0].length;
  const explain = (l) => {
    const m = l.match(/\b(it|test|describe|suite)\.(skip|todo|skipIf|runIf)\b(\s*\(([^)]*)\))?/);
    if (!m) {
      return '';
    }
    const [, kind, how, , cond] = m;
    if (how === 'skip') {
      return `${kind}.skip in the file`;
    }
    if (how === 'todo') {
      return `${kind}.todo: not written yet`;
    }
    const text = String(cond || '').trim();
    const direct = text.match(/process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]/);
    let variable = direct ? direct[1] || direct[2] : '';
    if (!variable) {
      const ident = text.replace(/^!+/, '').match(/^[A-Z_$][\w$]*/i)?.[0];
      const decl = ident && String(source).match(new RegExp(`(?:const|let|var)\\s+${ident}\\s*=([^;\\n]*)`));
      const env2 = decl && decl[1].match(/process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]/);
      if (env2) {
        variable = env2[1] || env2[2];
      }
    }
    const set = variable ? (env[variable] ? `${variable} is set` : `${variable} is not set in the test's environment`) : '';
    return `${kind}.${how}(${text.slice(0, 80)})${set ? `: ${set}` : ''}`;
  };
  const own = explain(lines[at]);
  if (own) {
    return own;
  }
  let indent = indentOf(lines[at]);
  for (let i = at - 1; i >= 0 && indent > 0; i -= 1) {
    const l = lines[i];
    if (!l.trim() || indentOf(l) >= indent) {
      continue;
    }
    indent = indentOf(l);
    const why = explain(l);
    if (why) {
      return why;
    }
  }
  return '';
}

/**
 * Criteria whose every named test was skipped: nothing ran for them, and the run says so loudly.
 * @param runs - [{ criterion, status, reason }].
 * @returns [{ criterion, reasons }]
 */
export function criteriaAllSkipped(runs) {
  const by = new Map();
  for (const r of runs || []) {
    if (!by.has(r.criterion)) {
      by.set(r.criterion, []);
    }
    by.get(r.criterion).push(r);
  }
  return [...by.entries()]
    .filter(([, rs]) => rs.every(r => r.status === 'skipped'))
    .map(([criterion, rs]) => ({ criterion, reasons: [...new Set(rs.map(r => r.reason || 'no reason found in the file'))] }));
}

/**
 * A named test passed only when its OWN line carries the pass mark. Exit 0 and the name in the
 * output are not enough: a skipped test (vitest prints it with a down arrow) does both, and on
 * #126 attempt 195 the pull request called a skipped lifecycle test passed until QA read the run.
 * @param output - The verbose reporter's output.
 * @param name - The test name.
 * @param code - The exit code.
 */
export function namedTestPassed(output, name, code) {
  return namedTestStatus(output, name, code).status === 'passed';
}

/**
 * Schema changes belong in migrations, never in application code. On request #124 the engineer
 * created two tables at runtime (CREATE TABLE IF NOT EXISTS via $executeRawUnsafe) in three
 * attempts running, and QA approved it: the production database user may not hold DDL rights, and
 * the tables live outside the schema the client is generated from. Tests and migrations may
 * speak DDL; nothing else in a change may.
 * @param files - Changed files, relative to the repo.
 * @param read - (relPath) => contents, or null.
 */
export function runtimeDdlHits(files, read) {
  const allowed = f => /(?:^|\/)migrations?\//.test(f) || /\.sql$/.test(f) || /(?:^|\/)(?:tests?|__tests__)\//.test(f) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f);
  const hits = [];
  for (const f of files) {
    if (allowed(f) || !/\.[cm]?[jt]sx?$/.test(f)) {
      continue;
    }
    const text = read(f);
    if (text === null) {
      continue;
    }
    text.split('\n').forEach((line, i) => {
      if (/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE)\b/i.test(line)) {
        hits.push(`${f}:${i + 1}`);
      }
    });
  }
  return hits;
}

/** A test name as a `-t` pattern that matches only itself: vitest reads -t as a regular expression. */
export function testNamePattern(name) {
  return String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A file a person owns: secrets and env files, .git and CI workflows, plus whatever the repository
 * names in the contract's `human_owned` (the repo record's `humanOwned`). The only files the
 * engineer may not change or keep; the same list hooks/guard-write.sh blocks. Everything else in
 * the repository is the engineer's to change when the outcome needs it. The runner's own hooks and
 * settings live outside the repository (RUNNER_HOME), where no write reaches.
 * @param {string} rel a path relative to the repository root
 * @param {string[]} [extra] globs from the contract's human_owned
 */
const HUMAN_OWNED = [/(^|\/)\.env(\.[^/]*)?$/, /\.pem$/, /\.key$/, /^\.git\//, /^\.github\/workflows\//];
export function humanOwned(rel, extra = []) {
  return HUMAN_OWNED.some(r => r.test(rel)) || (extra || []).some(g => globMatches(g, rel));
}

/** A repo-relative glob: ** across directories, * within one, ? one character; a bare directory covers what is under it. */
export function globToRegExp(glob) {
  const g = String(glob).trim().replace(/^\.\//, '');
  let out = '';
  for (let i = 0; i < g.length;) {
    if (g.startsWith('**/', i)) {
      out += '(?:.*/)?'; i += 3; continue;
    }
    if (g.startsWith('**', i)) {
      out += '.*'; i += 2; continue;
    }
    const c = g[i];
    if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    i++;
  }
  return new RegExp(`^${out}$`);
}

export function globMatches(glob, rel) {
  if (typeof glob !== 'string' || !glob.trim()) {
    return false;
  }
  if (globToRegExp(glob).test(rel)) {
    return true;
  }
  const dir = glob.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  return Boolean(dir) && !/[*?]/.test(dir) && (rel === dir || rel.startsWith(`${dir}/`));
}
