import type { AgentCallView, AgentTaskView, RunHeader, RunLogData, RunLogEvent } from './runLog';
import { describe, expect, it } from 'vitest';
import { agentSteps, deriveSteps, detailLines, eventLines, fallbackWorkerSteps, fireFailedLine, focusStep, formatDuration, mergeRunLog, refusedBeforeStart, startingFireId, stepOfPhase, stopReason, stripAnsi, workerSteps } from './runLog';

function header(over: Partial<RunHeader> = {}): RunHeader {
  return {
    kind: 'worker',
    ref: '7',
    id: 7,
    title: 'northwind-t12',
    objective: 'Add a PDF export to the room share menu.',
    status: 'running',
    attempt: 1,
    startedAt: '2026-09-28T10:00:00.000Z',
    endedAt: null,
    cents: 120,
    model: 'claude-sonnet-4-6',
    prUrl: null,
    error: null,
    summary: null,
    links: [],
    logLinks: { stream: null, stderr: null, checks: {} },
    attach: null,
    progress: { phase: null, note: null, log: [] },
    checks: [],
    failures: [],
    ...over,
  };
}

let seq = 0;
function ev(phase: string, fields: Record<string, unknown> = {}, over: Partial<RunLogEvent> = {}): RunLogEvent {
  seq += 1;
  return { seq, ts: new Date(Date.UTC(2026, 8, 28, 10, 0, seq)).toISOString(), phase, step: null, level: null, message: null, fields, ...over };
}

function run(): RunLogEvent[] {
  seq = 0;
  return [
    ev('claim', { note: 'run 7' }),
    ev('claimed', { attempt: 1 }),
    ev('prepare', { note: 'clone https://github.com/example/northwind-portal.git at origin/main' }),
    ev('prepared', { branch: 'factory/northwind-t12-pdf' }),
    ev('services', { note: 'postgres' }),
    ev('install', { note: 'npm ci --ignore-scripts, then the repo postinstall' }),
    ev('service.started', { service: 'postgres' }),
    ev('claude', { note: 'model=sonnet budget=$12' }),
    ev('claude.tool', { tool: 'Read', target: 'src/features/rooms/ShareMenu.tsx', ok: true }),
    ev('claude.tool', { tool: 'Bash', target: 'npm test -- rooms', ok: false, error: 'exit 1' }),
    ev('heartbeat', { stop: false }),
    ev('claude.finished', { exit_code: 0, cost_usd: 1.2 }),
    ev('verify'),
    ev('check', { name: 'typecheck', status: 'passed', exit_code: 0, duration_s: 31, tail: '\u001B[32mno errors\u001B[0m' }),
  ];
}

describe('a worker phase belongs to one step', () => {
  it('groups the worker\'s own phase names, and leaves bookkeeping to the running step', () => {
    expect(stepOfPhase('claude.tool')).toBe('claude');
    expect(stepOfPhase('check')).toBe('checks');
    expect(stepOfPhase('qa.step.failed')).toBe('qa');
    expect(stepOfPhase('pushed')).toBe('land');
    expect(stepOfPhase('pr.opened')).toBe('land');
    expect(stepOfPhase('installed')).toBe('install');
    expect(stepOfPhase('criteria.tests')).toBe('tests');
    expect(stepOfPhase('record.updated')).toBeNull();
    expect(stepOfPhase('heartbeat.rejected')).toBeNull();
  });
});

describe('an engineering run\'s steps', () => {
  it('reads as a runner: steps in the order they happened, the last one running while the run is live', () => {
    const steps = workerSteps(run(), header());

    expect(steps.map(s => [s.key, s.status])).toEqual([
      ['prepare', 'passed'],
      ['services', 'passed'],
      ['install', 'passed'],
      ['claude', 'passed'],
      ['checks', 'running'],
    ]);
    expect(steps.at(-1)!.endedAt).toBeNull();
    // A step ends where the next one's first line begins.
    expect(steps[0]!.endedAt).toBe(steps[1]!.startedAt);
  });

  it('folds a tool call\'s result into its line, and a failed result never fails the step', () => {
    seq = 0;
    const events = [
      ev('claude'),
      ev('claude.tool', { tool: 'Edit', target: 'src/a.ts', id: 'tu_1' }),
      ev('claude.tool', { tool: 'Bash', target: 'npm test', id: 'tu_2' }),
      ev('claude.tool.result', { id: 'tu_1', ok: true }),
      ev('claude.tool.result', { id: 'tu_2', ok: false, error: '1 failed' }, { level: 'error' }),
      ev('claude.tool', { tool: 'Read', target: 'src/b.ts', id: 'tu_3' }),
      ev('record.rejected', { status: 403 }, { level: 'error' }),
    ];
    const [claude] = workerSteps(events, header());

    expect(claude!.status).toBe('running');
    expect(claude!.lines.map(l => l.text)).toEqual(['claude', 'ok  Edit src/a.ts', 'err Bash npm test', '  1 failed', '... Read src/b.ts', 'record.rejected  status=403']);
    expect(workerSteps(events, header({ status: 'completed', endedAt: '2026-09-28T10:10:00.000Z' }))[0]!.status).toBe('passed');
  });

  it('draws one line per tool call, and a check\'s tail in full with its colour codes stripped', () => {
    const steps = workerSteps(run(), header());
    const claude = steps.find(s => s.key === 'claude')!;
    const checks = steps.find(s => s.key === 'checks')!;

    expect(claude.lines.map(l => l.text)).toEqual(expect.arrayContaining(['ok  Read src/features/rooms/ShareMenu.tsx', 'err Bash npm test -- rooms', '  exit 1']));
    expect(claude.lines.find(l => l.text.startsWith('err'))!.level).toBe('warn');
    expect(claude.lines.some(l => l.text.includes('heartbeat'))).toBe(false);
    expect(checks.lines.map(l => l.text)).toEqual(['verify', 'check typecheck: passed (exit 0, 31s)', '  no errors']);
  });

  it('paints the step a stopped run stopped in, and names the last step for what it was', () => {
    const events = [...run(), ev('check', { name: 'test', status: 'failed', exit_code: 1, tail: 'FAIL rooms.test.ts' }), ev('verify.failed', { error: 'required checks failed: test' }), ev('fail', { note: 'verification failed' })];
    const steps = workerSteps(events, header({ status: 'failed', endedAt: '2026-09-28T10:05:00.000Z' }));

    expect(steps.find(s => s.key === 'checks')!.status).toBe('failed');
    expect(steps.at(-1)).toMatchObject({ key: 'complete', name: 'Report failure', status: 'failed' });
    expect(focusStep(steps)).toBe('checks');
  });

  it('marks the last step failed when a run was lost without saying why', () => {
    seq = 0;
    const steps = workerSteps([ev('claim'), ev('claude')], header({ status: 'lost', endedAt: '2026-09-28T10:30:00.000Z' }));

    expect(steps.map(s => s.status)).toEqual(['passed', 'failed']);
    expect(steps.at(-1)!.endedAt).toBe('2026-09-28T10:30:00.000Z');
  });

  it('says a step was skipped when everything in it was', () => {
    seq = 0;
    const steps = workerSteps([ev('claim'), ev('qa.skipped', { note: 'QA_CAPTURE=0' }), ev('land')], header({ status: 'completed', endedAt: '2026-09-28T10:10:00.000Z' }));

    expect(steps.find(s => s.key === 'qa')!.status).toBe('skipped');
  });

  it('attaches the full logs the worker linked to the steps that produced them', () => {
    const steps = workerSteps(run(), header({ logLinks: { stream: 'https://logs.example/stream', stderr: null, checks: { typecheck: 'https://logs.example/typecheck' } } }));

    expect(steps.find(s => s.key === 'claude')!.links).toEqual([{ label: 'Full log', href: 'https://logs.example/stream', external: true }]);
    expect(steps.find(s => s.key === 'checks')!.links).toEqual([{ label: 'Full log: typecheck', href: 'https://logs.example/typecheck', external: true }]);
  });
});

describe('an engineering run that sent no lines', () => {
  it('falls back to what it kept: where it stopped, each check with its tail, the failures', () => {
    const steps = fallbackWorkerSteps(header({
      status: 'failed',
      error: 'verification failed: required checks failed: lint',
      endedAt: '2026-09-28T10:20:00.000Z',
      progress: { phase: 'verify', note: null, log: ['cloning', 'claude done'] },
      failures: [{ scope: 'check:lint', message: '3 problems' }, { scope: 'kept-work', message: 'factory/t12-wip-7' }],
    }));

    expect(steps.map(s => [s.name, s.status])).toEqual([
      ['Stopped at: Checks', 'failed'],
      ['Check: lint', 'failed'],
      ['Failures', 'failed'],
    ]);
    expect(steps[0]!.lines.map(l => l.text)).toEqual(['cloning', 'claude done', 'verification failed: required checks failed: lint']);
  });

  it('draws a completed run\'s checks from its result', () => {
    const data: RunLogData = { header: header({ status: 'completed', checks: [{ name: 'typecheck', status: 'passed', tail: 'ok', durationS: 12 }] }), events: [], tasks: [], calls: [], cursor: 0 };

    expect(deriveSteps(data).map(s => [s.name, s.status])).toEqual([['Check: typecheck', 'passed']]);
  });
});

describe('a run refused at its contract (red team, run 401, 2026-09-28)', () => {
  const reason = 'task contract refused: plan: this task needs an approved plan (risk_class schema). A required plan cannot be skipped. The contract must match factory/contracts/schema.json (snake_case keys, non-empty acceptance_contract and allowed_paths, risk_class from the list, required_checks from typecheck/test/lint/build) and carry an approved plan when the plan rule requires one.';
  const refused = header({
    status: 'failed',
    cents: 0,
    endedAt: '2026-09-28T10:00:00.400Z',
    startedAt: '2026-09-28T10:00:00.000Z',
    error: reason,
    progress: { phase: 'fail', note: reason, log: [] },
    failures: [{ scope: 'contract', message: 'plan: this task needs an approved plan' }],
  });

  it('names the step it stopped in, in words, never "Complete"', () => {
    const [step] = fallbackWorkerSteps(refused);

    expect(step!.name).toBe('Stopped at: Contract check');
    expect(fallbackWorkerSteps(header({ status: 'failed', error: 'land failed: gh pr create failed', progress: { phase: 'fail', note: null, log: [] } }))[0]!.name).toBe('Stopped at: Push and open pull request');
    expect(fallbackWorkerSteps(header({ status: 'lost', progress: { phase: 'fail', note: null, log: [] } }))[0]!.name).toBe('Stopped');
  });

  it('says a line once when the note and the error are the same words', () => {
    const [step] = fallbackWorkerSteps(refused);

    expect(step!.lines.map(l => l.text)).toEqual([reason]);
  });

  it('cuts a long stop reason at a sentence end, never mid-word', () => {
    expect(stopReason(reason)).toBe(reason);
    expect(stopReason(reason, 200)).toBe('task contract refused: plan: this task needs an approved plan (risk_class schema). A required plan cannot be skipped.');
    expect(stopReason('short reason')).toBe('short reason');
    // The worker ends a sentence and then appends its own stop (run 401): one stop, and an ellipsis stays.
    expect(stopReason('A required plan cannot be skipped.. The contract must match the schema.')).toBe('A required plan cannot be skipped. The contract must match the schema.');
    expect(stopReason('It waited... then stopped.')).toBe('It waited... then stopped.');
    expect(stopReason(`${'word '.repeat(120)}end`)).toMatch(/word…$/);
  });

  it('is refused before it started, not a run that took 0s', () => {
    expect(refusedBeforeStart({ header: refused, events: [], tasks: [], calls: [], cursor: 0 })).toBe(true);
    expect(refusedBeforeStart({ header: { ...refused, failures: [], error: 'verification failed: test', progress: { phase: 'verify', note: null, log: [] } }, events: [], tasks: [], calls: [], cursor: 0 })).toBe(false);
    expect(refusedBeforeStart({ header: { ...refused, cents: 40 }, events: [], tasks: [], calls: [], cursor: 0 })).toBe(false);
  });
});

describe('an agent run\'s steps', () => {
  const tasks: AgentTaskView[] = [
    { id: 't1', title: 'Read the contract', status: 'completed', owner: 'change-reviewer', output: 'Three criteria.', error: null, startedAt: '2026-09-28T09:00:00.000Z', endedAt: '2026-09-28T09:01:00.000Z' },
    { id: 't2', title: 'Review the change', status: 'failed', owner: 'change-reviewer', output: null, error: 'overloaded_error', startedAt: '2026-09-28T09:01:05.000Z', endedAt: '2026-09-28T09:02:00.000Z' },
    { id: 't3', title: 'Write the verdict', status: 'pending', owner: 'pm', output: null, error: null, startedAt: null, endedAt: null },
  ];
  const call = (id: number, at: string, over: Partial<AgentCallView> = {}): AgentCallView => ({ id, tool: 'search_knowledge', agent: 'change-reviewer', lead: null, input: 'contract', ok: true, error: null, ms: 800, at, ...over });

  it('is a step per plan task with its tool calls as lines, by the time each task ran', () => {
    const steps = agentSteps(tasks, [call(1, '2026-09-28T09:00:10.000Z'), call(2, '2026-09-28T09:01:30.000Z', { tool: 'read_pr', ok: false, error: 'timeout' })], header({ kind: 'agent', status: 'failed' }));

    expect(steps.map(s => [s.name, s.status])).toEqual([
      ['Read the contract · change-reviewer', 'passed'],
      ['Review the change · change-reviewer', 'failed'],
      ['Write the verdict · pm', 'pending'],
    ]);
    expect(steps[0]!.lines.map(l => l.text)).toEqual(['ok  search_knowledge contract  0.8s', '', 'Three criteria.']);
    expect(steps[1]!.lines.map(l => l.text)).toEqual(['err read_pr contract  0.8s', '  timeout', 'Error: overloaded_error']);
  });

  it('places an older run\'s calls by which agent made them when its tasks kept no times', () => {
    const untimed = [
      { ...tasks[0]!, owner: 'researcher', startedAt: null, endedAt: null },
      { ...tasks[1]!, owner: 'writer', startedAt: null, endedAt: null },
    ];
    const steps = agentSteps(untimed, [
      call(1, '2026-09-28T09:00:10.000Z', { agent: 'researcher' }),
      call(2, '2026-09-28T09:00:20.000Z', { agent: 'fact-checker', lead: 'researcher' }),
      call(3, '2026-09-28T09:01:30.000Z', { agent: 'writer', tool: 'create_artifact' }),
    ], header({ kind: 'agent', status: 'failed' }));

    expect(steps[0]!.lines.filter(l => l.text.startsWith('ok')).length).toBe(2);
    expect(steps[1]!.lines[0]!.text).toContain('create_artifact');
    expect(steps[0]!.startedAt).toBe('2026-09-28T09:00:10.000Z');
  });
});

describe('what a poll adds', () => {
  it('appends new lines, drops ones already held, and replaces the header', () => {
    const first = run();
    const prev: RunLogData = { header: header(), events: first.slice(0, 5), tasks: [], calls: [], cursor: 5 };
    const next: RunLogData = { header: header({ status: 'completed' }), events: first.slice(3), tasks: [], calls: [], cursor: first.length };
    const merged = mergeRunLog(prev, next);

    expect(merged.events.map(e => e.seq)).toEqual(first.map(e => e.seq));
    expect(merged.header.status).toBe('completed');
    expect(merged.cursor).toBe(first.length);
  });
});

describe('small print', () => {
  it('strips colour and cursor codes', () => {
    expect(stripAnsi('\u001B[1m\u001B[31mFAIL\u001B[39m\u001B[22m src/a.test.ts\r')).toBe('FAIL src/a.test.ts');
  });

  it('reads a generic line as its phase, its note and its small fields', () => {
    seq = 0;

    expect(eventLines(ev('pushed', { branch: 'factory/t12', commit_sha: 'abc123', run: 7, worker: 'w' }))[0]!.text).toBe('pushed  branch=factory/t12 commit_sha=abc123');
  });

  it('formats a duration the way a runner does', () => {
    expect(formatDuration(12_400)).toBe('12s');
    expect(formatDuration(64_000)).toBe('1m 04s');
    expect(formatDuration(3_780_000)).toBe('1h 03m');
    expect(formatDuration(null)).toBe('');
  });
});

describe('a mission run under a failed fire (backlog 032)', () => {
  it('finds the fire that started the run', () => {
    expect(startingFireId([{ automationSlug: 'contract-red-team-evidence', automationRunId: 7571 }])).toBe(7571);
    expect(startingFireId([{ automationSlug: 'x' }, { automationSlug: 'y', automationRunId: 12 }])).toBe(12);
    expect(startingFireId(null)).toBeNull();
    expect(startingFireId([{ automationSlug: 'x', automationRunId: 'nope' }])).toBeNull();
  });

  it('says the fire\'s failure in its first clause, without the automation\'s name', () => {
    expect(fireFailedLine('automation "contract-red-team-evidence": run #5737 ended without record_verdict, and the recording pass did not land it (Not recorded: a search box …)'))
      .toBe('failed: run #5737 ended without record_verdict');
    expect(fireFailedLine('abandoned: worker restart or activity timeout — the fire never reported an outcome'))
      .toBe('failed: abandoned: worker restart or activity timeout');
    expect(fireFailedLine(null)).toBe('failed: the automation reported an error');
  });
});

describe('the engineer\'s log reads like a Claude Code terminal (2026-09-29)', () => {
  const ev = (phase: string, fields: Record<string, unknown>, seq = 1) => ({ seq, ts: '2026-09-29T17:30:00Z', step: null, level: 'info' as const, phase, message: null, fields });

  it('draws the engineer\'s words as prose, a diff as +/- lines, and a command\'s output under it', () => {
    expect(eventLines(ev('claude.text', { text: 'The route reads the org from the session; the helper should take it as an argument.' }))).toEqual([
      { text: 'The route reads the org from the session; the helper should take it as an argument.', level: 'info', kind: 'say' },
    ]);

    const edit = eventLines(ev('claude.tool', { tool: 'Edit', target: 'apps/api/src/routes/documents.ts', diff: '- const doc = await loadDocument(id);\n+ const doc = await loadDocument(id, actingOrg);' }), { ok: true, error: null });

    expect(edit.map(l => l.kind)).toEqual([undefined, 'del', 'add']);

    const bash = eventLines(ev('claude.tool', { tool: 'Bash', target: 'npm test' }), { ok: true, error: null, output: 'Tests  12 passed (12)' });

    expect(bash[1]).toEqual({ text: '  Tests  12 passed (12)', level: 'info', kind: 'out' });
  });

  it('caps a long diff and says how much was left out', () => {
    const diff = Array.from({ length: 60 }, (_, i) => `+ line ${i}`).join('\n');
    const lines = detailLines(diff, null);

    expect(lines).toHaveLength(41);
    expect(lines.at(-1)!.text).toBe('  … 20 more lines');
  });
});
