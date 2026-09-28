/**
 * A RUN READS LIKE A RUNNER PAGE (backlog 036; Chris, 2026-09-28: "for live
 * runs, I'd expect it to look like a GitHub runner or Vercel deployment
 * page"). A list of steps, each with a status, a duration and its log lines.
 *
 * Pure and client-safe: the server reads the rows (`services/runs/
 * RunLogService.ts`), the page polls for the lines after the last one it
 * has, and both derive the steps with the functions here, so what the first
 * render shows and what a poll adds up to are the same thing.
 *
 * One shape for both kinds of run:
 *   - an engineering run (worker_run): the worker's step lines
 *     (`worker_run_event`), grouped by the step each phase belongs to; an
 *     older run with no lines falls back to what it kept — the last
 *     progress, the check tails, the failures;
 *   - an agent run (mission_run): a step per plan task, a line per tool call.
 */

export type RunLogLevel = 'info' | 'warn' | 'error';

/** One stored line of an engineering run, as the page receives it. */
export type RunLogEvent = {
  seq: number;
  ts: string;
  phase: string;
  step: string | null;
  level: RunLogLevel | null;
  message: string | null;
  fields: Record<string, unknown>;
};

/** One plan task of an agent run. */
export type AgentTaskView = {
  id: string;
  title: string;
  status: string;
  owner: string | null;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
};

/** One tool call of an agent run. */
export type AgentCallView = {
  id: number;
  tool: string;
  /** The agent that made the call, and the lead it worked for when delegated. */
  agent: string;
  lead: string | null;
  input: string;
  ok: boolean;
  error: string | null;
  ms: number | null;
  at: string;
};

export type RunLink = { label: string; href: string; external: boolean };

export type RunCheck = { name: string; status: string; tail: string | null; durationS: number | null };

/** What the page says about the run above its steps. */
export type RunHeader = {
  kind: 'worker' | 'agent';
  /** The id in the run page's path: `123`, or `agent-45`. */
  ref: string;
  id: number;
  title: string;
  objective: string | null;
  status: string;
  attempt: number | null;
  startedAt: string | null;
  endedAt: string | null;
  cents: number | null;
  model: string | null;
  prUrl: string | null;
  error: string | null;
  summary: string | null;
  /** Run-level documents: the transcript and the prompt. */
  links: RunLink[];
  /** Full logs the worker keeps in its own storage (presigned). */
  logLinks: { stream: string | null; stderr: string | null; checks: Record<string, string> };
  /** The block a person pastes into Claude Code, on a run that stopped. */
  attach: string | null;
  /** What an older run kept, drawn as steps when it has no lines. */
  progress: { phase: string | null; note: string | null; log: string[] };
  checks: RunCheck[];
  failures: Array<{ scope: string; message: string }>;
};

/** Everything the run page draws, and what a poll returns. */
export type RunLogData = {
  header: RunHeader;
  events: RunLogEvent[];
  tasks: AgentTaskView[];
  calls: AgentCallView[];
  /** The highest seq (engineering) or tool call id (agent) held — the next poll's `after`. */
  cursor: number;
};

export type RunStepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export type RunLogLine = { text: string; level: RunLogLevel };

export type RunStep = {
  key: string;
  name: string;
  status: RunStepStatus;
  startedAt: string | null;
  /** Null while the step is running — the page counts up from `startedAt`. */
  endedAt: string | null;
  lines: RunLogLine[];
  links: RunLink[];
};

/**
 * A run the page keeps polling: it can still change without a person acting.
 * @param status
 */
export function isLiveStatus(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'paused' || status === 'planning';
}

const FAILED_RUN = new Set(['failed', 'lost', 'cancelled']);

/* ------------------------------------------------------------------ */
/* ANSI                                                                 */
/* ------------------------------------------------------------------ */

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
// CSI sequences (colour, cursor) and OSC sequences (titles, hyperlinks).
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[\\x20-\\x2F]*[\\x40-\\x7E]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[\\x40-\\x5A\\x5C-\\x5F]`, 'g');

/**
 * Terminal colour codes out, so a check tail reads as text.
 * @param text - A line as a terminal printed it.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '').replace(/\r(?!\n)/g, '');
}

/* ------------------------------------------------------------------ */
/* Engineering runs                                                     */
/* ------------------------------------------------------------------ */

/** Step keys in the order a run normally meets them, and what each is called on the page. */
export const WORKER_STEPS: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'prepare', name: 'Set up' },
  { key: 'install', name: 'Install dependencies' },
  { key: 'services', name: 'Start services' },
  { key: 'claude', name: 'Claude Code' },
  { key: 'checks', name: 'Checks' },
  { key: 'qa', name: 'QA evidence' },
  { key: 'tests', name: 'Named tests' },
  { key: 'keep', name: 'Keep work' },
  { key: 'land', name: 'Push and open pull request' },
  { key: 'complete', name: 'Complete' },
];

const STEP_NAME = new Map(WORKER_STEPS.map(s => [s.key, s.name]));

const EXACT: Record<string, string> = {
  boot: 'prepare',
  claim: 'prepare',
  claimed: 'prepare',
  poll: 'prepare',
  plan: 'prepare',
  task: 'prepare',
  prepare: 'prepare',
  prepared: 'prepare',
  services: 'services',
  services_started: 'services',
  claude: 'claude',
  paused: 'claude',
  verify: 'checks',
  verified: 'checks',
  check: 'checks',
  keep: 'keep',
  kept: 'keep',
  land: 'land',
  pushed: 'land',
  complete: 'complete',
  completed: 'complete',
  done: 'complete',
  fail: 'complete',
  failed: 'complete',
  crash: 'complete',
};

/** Prefixes a phase is grouped by when it is not named exactly. */
const PREFIX: ReadonlyArray<[string, string]> = [
  ['claim.', 'prepare'],
  ['poll.', 'prepare'],
  ['task.', 'prepare'],
  ['contract.', 'prepare'],
  ['install', 'install'],
  ['service', 'services'],
  ['claude.', 'claude'],
  ['verify.', 'checks'],
  ['check.', 'checks'],
  ['qa', 'qa'],
  ['criteria.tests', 'tests'],
  ['tests', 'tests'],
  ['keep.', 'keep'],
  ['kept.', 'keep'],
  ['pr.', 'land'],
  ['complete.', 'complete'],
  ['fail.', 'complete'],
];

/**
 * The step a worker phase belongs to, or null for a line that belongs to
 * whatever step is running (a heartbeat, a record write, a retry, a warning).
 * @param phase - The worker's name for the line.
 */
export function stepOfPhase(phase: string): string | null {
  if (EXACT[phase]) {
    return EXACT[phase];
  }
  for (const [prefix, key] of PREFIX) {
    if (phase.startsWith(prefix)) {
      return key;
    }
  }
  return null;
}

/**
 * Lines that are never a reason to paint a step red, whatever their level:
 * bookkeeping (a record write, a log upload, a label), and a tool call the
 * engineer made that failed — a red test while it iterates is how the work
 * goes, not a failed step. The line itself still reads as an error.
 */
const NEVER_FATAL = /^(?:record\.|heartbeat|vocion\.|label\.|logs\.|events\.|warn$|claude\.tool(?:\.result)?$)/;

/**
 * Whether a line fails the step it is in.
 * @param e - The event.
 */
export function failsStep(e: Pick<RunLogEvent, 'phase' | 'level' | 'fields'>): boolean {
  return eventLevel(e) === 'error' && !NEVER_FATAL.test(e.phase);
}

/**
 * An event's level: what the worker said, else read off the line — a failed
 * check, a failed tool call, a phase that names a failure.
 * @param e - The event.
 */
export function eventLevel(e: Pick<RunLogEvent, 'phase' | 'level' | 'fields'>): RunLogLevel {
  if (e.level) {
    return e.level;
  }
  const failedField = e.fields.status === 'failed' || e.fields.ok === false;
  const failedPhase = /(?:^|\.)(?:failed|error|crashed|refused|rejected|crash|fail)$/.test(e.phase);
  if (failedField || failedPhase) {
    return NEVER_FATAL.test(e.phase) ? 'warn' : 'error';
  }
  if (/(?:^|\.)(?:skipped|retry|warn|kill)$/.test(e.phase)) {
    return 'warn';
  }
  return 'info';
}

/** Multi-line fields a worker attaches to a line: each is drawn under it, in full. */
const BLOCK_FIELDS = ['tail', 'stderr_tail', 'migrations_tail', 'result_preview', 'error', 'output'];
/** Fields that are the run's bookkeeping, not what happened. */
const QUIET_FIELDS = new Set(['run', 'worker', 'elapsed_s', 'ts', 'phase', 'note', ...BLOCK_FIELDS]);

function scalar(v: unknown): string | null {
  if (typeof v === 'string') {
    return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  if (Array.isArray(v) && v.every(x => typeof x === 'string' || typeof x === 'number')) {
    const s = v.join(', ');
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  }
  return null;
}

/** How a tool call came back: from its `claude.tool.result` line, or from the call's own `ok`. */
export type ToolOutcome = { ok: boolean; error: string | null };

/**
 * The lines one event contributes to its step: a headline, then any
 * multi-line output under it (a check's tail, stderr), ANSI stripped. A tool
 * call reads as one line — `ok`, `err`, or `...` while it has not come back —
 * with its error under it.
 * @param e - The event.
 * @param outcome - For a `claude.tool` line, how the call came back, when known.
 */
export function eventLines(e: RunLogEvent, outcome?: ToolOutcome | null): RunLogLine[] {
  const level = eventLevel(e);
  const f = e.fields;
  let head: string;
  if (e.phase === 'claude.tool') {
    const r = outcome ?? (typeof f.ok === 'boolean' ? { ok: f.ok, error: typeof f.error === 'string' ? f.error : null } : null);
    const mark = r === null ? '...' : r.ok ? 'ok ' : 'err';
    const lines: RunLogLine[] = [{ text: stripAnsi(`${mark} ${String(f.tool ?? 'tool')}${f.target ? ` ${String(f.target)}` : ''}`), level: r && !r.ok ? 'warn' : 'info' }];
    if (r?.error) {
      lines.push(...stripAnsi(r.error).replace(/\s+$/, '').split('\n').map(t => ({ text: `  ${t}`, level: 'warn' as const })));
    }
    return lines;
  }
  if (e.phase === 'check' && typeof f.name === 'string') {
    const bits = [typeof f.exit_code === 'number' ? `exit ${f.exit_code}` : null, typeof f.duration_s === 'number' ? `${f.duration_s}s` : null].filter(Boolean);
    head = `check ${f.name}: ${String(f.status ?? '')}${bits.length ? ` (${bits.join(', ')})` : ''}`;
  } else {
    const note = e.message ?? (typeof f.note === 'string' ? f.note : null);
    const extras = Object.entries(f)
      .filter(([k]) => !QUIET_FIELDS.has(k))
      .map(([k, v]) => {
        const s = scalar(v);
        return s === null || s === '' ? null : `${k}=${s}`;
      })
      .filter(Boolean)
      .join(' ');
    head = [e.phase, note, extras].filter(Boolean).join('  ');
  }
  const lines: RunLogLine[] = [{ text: stripAnsi(head), level }];
  for (const key of BLOCK_FIELDS) {
    const v = f[key];
    if (typeof v === 'string' && v.trim()) {
      for (const l of stripAnsi(v).replace(/\s+$/, '').split('\n')) {
        lines.push({ text: `  ${l}`, level: key === 'error' ? 'error' : 'info' });
      }
    }
  }
  return lines;
}

function linkFor(label: string, href: string | null | undefined): RunLink | null {
  return href ? { label, href, external: /^https?:\/\//.test(href) } : null;
}

function stepLinks(key: string, header: RunHeader): RunLink[] {
  if (key === 'claude') {
    return [linkFor('Full log', header.logLinks.stream), linkFor('stderr', header.logLinks.stderr)].filter((l): l is RunLink => l !== null);
  }
  if (key === 'checks') {
    return Object.entries(header.logLinks.checks).map(([name, href]) => ({ label: `Full log: ${name}`, href, external: true }));
  }
  return [];
}

/**
 * The steps of an engineering run from its lines. A step appears where its
 * first line does and ends where the next step's line begins; a step the
 * worker comes back to (installing during the checks) keeps its lines
 * together. The running step is the last one while the run is live; a run
 * that stopped paints the step it stopped in red.
 * @param events - The run's lines, any order.
 * @param header - The run.
 */
export function workerSteps(events: readonly RunLogEvent[], header: RunHeader): RunStep[] {
  // A tool call and its result are one line: the result is folded into the
  // call it answers, and only an orphaned result is drawn on its own.
  const callIds = new Set(events.filter(e => e.phase === 'claude.tool' && typeof e.fields.id === 'string').map(e => e.fields.id as string));
  const outcomes = new Map<string, ToolOutcome>();
  for (const e of events) {
    if (e.phase === 'claude.tool.result' && typeof e.fields.id === 'string') {
      outcomes.set(e.fields.id, { ok: e.fields.ok !== false, error: typeof e.fields.error === 'string' ? e.fields.error : null });
    }
  }
  const sorted = [...events]
    .filter(e => e.phase !== 'heartbeat' && !(e.phase === 'claude.tool.result' && callIds.has(e.fields.id as string)))
    .sort((a, b) => a.seq - b.seq);
  const steps: Array<RunStep & { fatal: boolean; skippedOnly: boolean; lastIndex: number; hasFail: boolean }> = [];
  const byKey = new Map<string, typeof steps[number]>();
  let current: string | null = null;
  sorted.forEach((e, i) => {
    const key = e.step ?? stepOfPhase(e.phase) ?? current ?? 'prepare';
    current = key;
    let step = byKey.get(key);
    if (!step) {
      step = { key, name: STEP_NAME.get(key) ?? key, status: 'passed', startedAt: e.ts, endedAt: null, lines: [], links: stepLinks(key, header), fatal: false, skippedOnly: true, lastIndex: i, hasFail: false };
      byKey.set(key, step);
      steps.push(step);
    }
    step.lastIndex = i;
    step.fatal ||= failsStep(e);
    step.lines.push(...eventLines(e, typeof e.fields.id === 'string' ? outcomes.get(e.fields.id) : null));
    if (!(e.phase.endsWith('.skipped') || e.fields.status === 'skipped')) {
      step.skippedOnly = false;
    }
    if (/^(?:fail|failed|crash)(?:\.|$)/.test(e.phase)) {
      step.hasFail = true;
    }
  });
  const live = isLiveStatus(header.status);
  const stopped = FAILED_RUN.has(header.status);
  steps.forEach((s) => {
    const next = sorted[s.lastIndex + 1];
    s.endedAt = next ? next.ts : (live ? null : header.endedAt ?? sorted[s.lastIndex]!.ts);
    if (s.key === 'complete') {
      s.name = s.hasFail || stopped ? 'Report failure' : 'Complete';
      s.status = stopped ? 'failed' : live ? 'running' : 'passed';
      return;
    }
    s.status = s.fatal ? 'failed' : s.skippedOnly ? 'skipped' : 'passed';
  });
  const work = steps.filter(s => s.key !== 'complete');
  const last = work.at(-1);
  if (live && last && steps.at(-1) === last && last.status !== 'failed') {
    last.status = 'running';
    last.endedAt = null;
  }
  if (stopped && last && !work.some(s => s.status === 'failed')) {
    last.status = 'failed';
  }
  return steps.map(({ fatal: _l, skippedOnly: _s, lastIndex: _i, hasFail: _f, ...s }) => s);
}

function checkStatus(status: string): RunStepStatus {
  return status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : status === 'skipped' ? 'skipped' : 'pending';
}

function tailLines(text: string | null | undefined, level: RunLogLevel = 'info'): RunLogLine[] {
  if (!text || !text.trim()) {
    return [];
  }
  return stripAnsi(text).replace(/\s+$/, '').split('\n').map(t => ({ text: t, level }));
}

/** What a failure's scope says about where the run was. */
const SCOPE_STEP: ReadonlyArray<[RegExp, string]> = [
  [/^contract$/, 'Contract check'],
  [/^git$/, 'Set up'],
  [/^services$/, 'Start services'],
  [/^claude$/, 'Claude Code'],
  [/^check:/, 'Checks'],
  [/^control$/, 'Stopped by Vocion'],
];

/** What the worker's error says about where the run was, by how the worker words each stop. */
const ERROR_STEP: ReadonlyArray<[RegExp, string]> = [
  [/^bad task input|contract|plan cannot be skip|required plan/i, 'Contract check'],
  [/^prepare failed/i, 'Set up'],
  [/^services failed/i, 'Start services'],
  [/^claude (?:exited|reported)/i, 'Claude Code'],
  [/^verif/i, 'Checks'],
  [/^land failed/i, 'Push and open pull request'],
  [/^stopped by Vocion/i, 'Stopped by Vocion'],
];

/**
 * The step a stopped run stopped in, in words. The worker's last phase names
 * it when it is a working step; when it is the report itself (`fail`,
 * `crash`) the failure's scope or the error's wording does — never
 * "Complete" on a run that did not complete.
 * @param header - The run.
 */
export function stoppedStepName(header: RunHeader): string {
  const phase = header.progress.phase;
  const key = phase ? stepOfPhase(phase) : null;
  if (key && key !== 'complete') {
    return `Stopped at: ${STEP_NAME.get(key) ?? key}`;
  }
  for (const f of header.failures) {
    const hit = SCOPE_STEP.find(([re]) => re.test(f.scope));
    if (hit) {
      return hit[1].startsWith('Stopped') ? hit[1] : `Stopped at: ${hit[1]}`;
    }
  }
  const hit = header.error ? ERROR_STEP.find(([re]) => re.test(header.error!)) : null;
  if (hit) {
    return hit[1].startsWith('Stopped') ? hit[1] : `Stopped at: ${hit[1]}`;
  }
  return 'Stopped';
}

/**
 * A run that was refused before it did any work — its contract or its claim
 * turned down, nothing spent. Its duration is the time it took to say no,
 * which is not worth a number.
 * @param data - The run.
 */
export function refusedBeforeStart(data: RunLogData): boolean {
  const h = data.header;
  if (h.kind !== 'worker' || !FAILED_RUN.has(h.status) || (h.cents ?? 0) > 0) {
    return false;
  }
  return h.failures.some(f => f.scope === 'contract')
    || data.events.some(e => e.phase === 'contract.refused' || e.phase === 'claim.refused')
    || stoppedStepName(h) === 'Stopped at: Contract check';
}

/**
 * The reason a run stopped, as one paragraph a person reads whole: its first
 * line, and when that runs long, cut at the last sentence end that fits —
 * never mid-word. The full text is in the step log.
 * @param text - The run's error.
 * @param max - The most characters to show.
 */
export function stopReason(text: string, max = 400): string {
  const first = text.trim().split('\n')[0]!.trim();
  if (first.length <= max) {
    return first;
  }
  const head = first.slice(0, max);
  const ends = [...head.matchAll(/[.!?](?=\s|$)/g)].map(m => m.index!);
  const end = ends.at(-1);
  if (end !== undefined && end >= 40) {
    return head.slice(0, end + 1);
  }
  const space = head.lastIndexOf(' ');
  return `${head.slice(0, space > 40 ? space : max).replace(/[\s,;:]+$/, '')}…`;
}

/**
 * An engineering run that sent no lines (every run before backlog 036): the
 * steps it can still show — where it got to with its last lines, each check
 * with its tail, and its failures.
 * @param header - The run.
 */
export function fallbackWorkerSteps(header: RunHeader): RunStep[] {
  const live = isLiveStatus(header.status);
  const stopped = FAILED_RUN.has(header.status);
  const steps: RunStep[] = [];
  const phase = header.progress.phase;
  // The worker's note is often the error itself; a line said twice is read twice.
  const said = new Set<string>();
  const progressLines = [
    ...(header.progress.note ? tailLines(header.progress.note) : []),
    ...header.progress.log.map(t => ({ text: stripAnsi(t), level: 'info' as const })),
    ...(stopped && header.error ? tailLines(header.error, 'error') : []),
  ].filter((l) => {
    const t = l.text.trim();
    if (t && said.has(t)) {
      return false;
    }
    said.add(t);
    return true;
  });
  if (phase || progressLines.length > 0) {
    const key = phase ? stepOfPhase(phase) ?? phase : 'progress';
    steps.push({
      key: `progress:${key}`,
      name: live ? `Now: ${STEP_NAME.get(key) ?? phase ?? 'working'}` : stopped ? stoppedStepName(header) : 'Last progress',
      status: live ? 'running' : stopped ? 'failed' : 'passed',
      startedAt: header.startedAt,
      endedAt: live ? null : header.endedAt,
      lines: progressLines,
      links: [],
    });
  }
  const seen = new Set<string>();
  for (const c of header.checks) {
    seen.add(c.name);
    steps.push({
      key: `check:${c.name}`,
      name: `Check: ${c.name}`,
      status: checkStatus(c.status),
      startedAt: null,
      endedAt: null,
      lines: tailLines(c.tail),
      links: header.logLinks.checks[c.name] ? [{ label: 'Full log', href: header.logLinks.checks[c.name]!, external: true }] : [],
    });
  }
  // A failed run kept its checks only as failures scoped `check:<name>`.
  const other: RunLogLine[] = [];
  for (const f of header.failures) {
    const check = /^check:(.+)$/.exec(f.scope)?.[1];
    if (check && !seen.has(check)) {
      seen.add(check);
      steps.push({ key: `check:${check}`, name: `Check: ${check}`, status: 'failed', startedAt: null, endedAt: null, lines: tailLines(f.message), links: [] });
    } else if (!check) {
      other.push(...tailLines(`${f.scope}: ${f.message}`, 'error'));
    }
  }
  if (other.length > 0) {
    steps.push({ key: 'failures', name: 'Failures', status: 'failed', startedAt: null, endedAt: null, lines: other, links: [] });
  }
  return steps;
}

/* ------------------------------------------------------------------ */
/* Agent runs                                                           */
/* ------------------------------------------------------------------ */

function taskStatus(status: string): RunStepStatus {
  switch (status) {
    case 'completed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'skipped':
      return 'skipped';
    default:
      return 'pending';
  }
}

function callLine(c: AgentCallView): RunLogLine[] {
  const took = c.ms === null ? '' : `  ${(c.ms / 1000).toFixed(1)}s`;
  const by = c.lead ? `  (${c.agent})` : '';
  const lines: RunLogLine[] = [{ text: `${c.ok ? 'ok ' : 'err'} ${c.tool}${c.input ? ` ${c.input}` : ''}${took}${by}`, level: c.ok ? 'info' : 'error' }];
  if (c.error) {
    lines.push(...tailLines(c.error, 'error').map(l => ({ ...l, text: `  ${l.text}` })));
  }
  return lines;
}

/**
 * Which task each tool call belongs to. Tasks run one at a time in plan
 * order (`services/missions/runtime.ts`), so a task that recorded when it
 * started and ended owns the calls in that window. An older task that
 * recorded neither owns the calls its agent made (the lead, for a delegated
 * specialist) from its turn onwards, until a later task's agent takes over.
 * @param tasks - The plan.
 * @param calls - The run's tool calls, in time order.
 */
function assignCalls(tasks: readonly AgentTaskView[], calls: readonly AgentCallView[]): Map<string, AgentCallView[]> {
  const out = new Map<string, AgentCallView[]>(tasks.map(t => [t.id, []]));
  const ran = tasks.filter(t => t.status !== 'pending' && t.status !== 'skipped' && t.status !== 'awaiting_approval');
  let cursor = 0;
  for (const c of calls) {
    const at = Date.parse(c.at);
    const windowed = ran.find(t => t.startedAt && Date.parse(t.startedAt) <= at && (!t.endedAt || at <= Date.parse(t.endedAt) + 1000));
    if (windowed) {
      out.get(windowed.id)!.push(c);
      continue;
    }
    const who = c.lead ?? c.agent;
    const ahead = ran.findIndex((t, i) => i >= cursor && t.owner === who);
    if (ahead >= 0) {
      cursor = ahead;
    }
    const owner = ran[cursor];
    if (owner) {
      out.get(owner.id)!.push(c);
    }
  }
  return out;
}

/**
 * The steps of an agent run: one per plan task, its tool calls as lines,
 * then its error and its output.
 * @param tasks - The plan.
 * @param calls - The run's tool calls.
 * @param header - The run.
 */
export function agentSteps(tasks: readonly AgentTaskView[], calls: readonly AgentCallView[], header: RunHeader): RunStep[] {
  const sortedCalls = [...calls].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id);
  const owned = assignCalls(tasks, sortedCalls);
  const live = isLiveStatus(header.status);
  return tasks.map((t) => {
    const mine = owned.get(t.id) ?? [];
    const first = mine[0];
    const lastCall = mine.at(-1);
    const status = taskStatus(t.status);
    const lastEnd = lastCall ? new Date(Date.parse(lastCall.at) + (lastCall.ms ?? 0)).toISOString() : null;
    return {
      key: `task:${t.id}`,
      name: t.owner ? `${t.title} · ${t.owner}` : t.title,
      status: status === 'running' && !live ? 'failed' : status,
      startedAt: t.startedAt ?? first?.at ?? null,
      endedAt: status === 'running' && live ? null : t.endedAt ?? lastEnd,
      lines: [
        ...mine.flatMap(callLine),
        ...tailLines(t.error ? `Error: ${t.error}` : null, 'error'),
        ...(t.output ? [{ text: '', level: 'info' as const }, ...tailLines(t.output)] : []),
      ],
      links: [],
    };
  });
}

/* ------------------------------------------------------------------ */
/* Both                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The steps the page draws for a run, whichever kind it is.
 * @param data - What the server returned, merged with every poll since.
 */
export function deriveSteps(data: RunLogData): RunStep[] {
  if (data.header.kind === 'agent') {
    return agentSteps(data.tasks, data.calls, data.header);
  }
  return data.events.length > 0 ? workerSteps(data.events, data.header) : fallbackWorkerSteps(data.header);
}

/**
 * Fold a poll into what the page holds: the run's header and plan are
 * replaced (they are small and change in place), lines and calls are
 * appended, a seq or id already held is dropped.
 * @param prev - What the page holds.
 * @param next - What the poll returned (lines after `prev.cursor`).
 */
export function mergeRunLog(prev: RunLogData, next: RunLogData): RunLogData {
  const seqs = new Set(prev.events.map(e => e.seq));
  const ids = new Set(prev.calls.map(c => c.id));
  return {
    header: next.header,
    tasks: next.tasks,
    events: [...prev.events, ...next.events.filter(e => !seqs.has(e.seq))],
    calls: [...prev.calls, ...next.calls.filter(c => !ids.has(c.id))],
    cursor: Math.max(prev.cursor, next.cursor),
  };
}

/**
 * The step a person should be looking at: the running one, else the first
 * that failed. Null when everything passed.
 * @param steps - The run's steps.
 */
export function focusStep(steps: readonly RunStep[]): string | null {
  return (steps.find(s => s.status === 'running') ?? steps.find(s => s.status === 'failed'))?.key ?? null;
}

/**
 * "1m 04s", "12s", "1h 03m" — a runner's duration.
 * @param ms - Milliseconds.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return '';
  }
  const s = Math.floor(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  }
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
