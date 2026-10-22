/**
 * HOW A ROUTINE READS — the words, tones and numbers every surface that draws
 * a routine or a batch of its runs shares: the list, the routine's page, the
 * batch queue, the chat pane and the follow chip under an answer. Pure and
 * client-safe, so the page and the server's follow status say the same thing
 * (`services/preview/followStatus.ts`).
 *
 * Also the "Run it" form's reader: rows pasted as CSV, TSV or a JSON array,
 * matched to the routine's input names (`parseRows`).
 */

import type { RoutineInputSpec, RoutineRunStatus, RoutineStatus, RoutineTeaching, RoutineTrust, RoutineView } from './types';
import { ROUTINE_LIMITS } from './types';

/** The tones the design system draws a state in (`components/ui/status-pill` `TONE`). */
export type RoutineTone = 'pass' | 'amber' | 'fail' | 'neutral' | 'teal';

/** A routine's batches, as its page lists them (`routineReads.batchesOf`). */
export type RoutineBatchSummary = {
  id: number;
  status: 'running' | 'done';
  total: number;
  counts: Partial<Record<RoutineRunStatus, number>>;
  startedAt: string;
  endedAt: string | null;
};

/** The trust ladder's rungs as chips: a draft is plain, approved is the secondary teal, autonomous has earned the green. */
export const TRUST_TONE: Record<RoutineTrust, RoutineTone> = { drafted: 'neutral', approved: 'teal', autonomous: 'pass' };

/** What each rung means, in a line, for the control's tooltip. */
export const TRUST_HINT: Record<RoutineTrust, string> = {
  drafted: 'Every consequential click waits for a person.',
  approved: 'The writes the approved spec names run unattended; anything else still waits.',
  autonomous: 'Runs on its own; the expert reviews exceptions and samples.',
};

/** A teaching session's state, in a few words. */
export const TEACHING_WORD: Record<RoutineTeaching['state'], string> = {
  waiting_for_recording: 'Waiting for your recording',
  reading: 'Reading the recording',
  drafting: 'Drafting the spec',
  failed: 'Could not learn it',
};

/**
 * Where a routine stands, in a word.
 * @param r - The routine.
 * @param r.status - Its status.
 * @param r.error - Why teaching failed, when it did.
 * @param r.teaching - The teaching session, while one runs.
 * @param r.teaching
 */
export function routineStatusWord(r: { status: RoutineStatus; error?: string | null; teaching?: RoutineTeaching | null }): { tone: RoutineTone; word: string; pulse: boolean } {
  if (r.teaching?.state === 'failed' || (r.error && r.status === 'teaching')) {
    return { tone: 'fail', word: 'Could not learn it', pulse: false };
  }
  if (r.teaching) {
    return { tone: 'amber', word: TEACHING_WORD[r.teaching.state], pulse: true };
  }
  switch (r.status) {
    case 'teaching':
      return { tone: 'amber', word: 'Learning from the recording', pulse: true };
    case 'in_review':
      return { tone: 'amber', word: 'In review', pulse: false };
    case 'live':
      return { tone: 'pass', word: 'Live', pulse: false };
    default:
      return { tone: 'neutral', word: 'Retired', pulse: false };
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The open questions on the version in review, or on the version runs use.
 * @param r - The routine.
 */
export function openQuestions(r: Pick<RoutineView, 'draft' | 'version'>): number {
  return ((r.draft ?? r.version)?.spec.questions ?? []).filter(q => !q.answer).length;
}

/**
 * The routine's line on the list, under its name: where it is, and how it has gone.
 * @param r - The routine.
 */
export function routineLine(r: RoutineView): string {
  const expert = r.expert?.name ?? null;
  if (r.teaching || r.status === 'teaching') {
    if (r.teaching?.state === 'failed' || r.error) {
      return r.error ? `Could not learn it: ${r.error}` : 'Could not learn it';
    }
    return `Teaching · ${(r.teaching ? TEACHING_WORD[r.teaching.state] : 'Reading the recording').toLowerCase()}`;
  }
  if (r.status === 'retired') {
    return 'Retired · kept, never run again';
  }
  const parts: string[] = [];
  if (r.status === 'in_review') {
    parts.push(expert ? `Drafted · in review with ${expert}` : 'Drafted · in review');
    const open = openQuestions(r);
    if (open > 0) {
      parts.push(plural(open, 'open question'));
    }
    return parts.join(' · ');
  }
  const s = r.stats;
  if (s.runs === 0) {
    return expert ? `Approved · not run yet · ${expert} is its expert` : 'Approved · not run yet';
  }
  parts.push(plural(s.runs, 'run'), `${s.done} done`);
  if (s.escalated > 0) {
    parts.push(plural(s.escalated, 'exception'));
  }
  if (s.failed > 0) {
    parts.push(`${s.failed} failed`);
  }
  if (r.draft) {
    parts.push(`v${r.draft.n} in review`);
  }
  return parts.join(' · ');
}

/** How each run status reads on a tile: its word, its tone, whether it is moving, and whether it wants a person. */
export const RUN_STATUS: Record<RoutineRunStatus, { word: string; tone: RoutineTone; pulse: boolean; wantsYou: boolean }> = {
  queued: { word: 'Queued', tone: 'neutral', pulse: false, wantsYou: false },
  running: { word: 'Running', tone: 'amber', pulse: true, wantsYou: false },
  waiting: { word: 'Waiting on you', tone: 'amber', pulse: true, wantsYou: true },
  escalated: { word: 'Escalated', tone: 'amber', pulse: false, wantsYou: true },
  done: { word: 'Done', tone: 'pass', pulse: false, wantsYou: false },
  failed: { word: 'Failed', tone: 'fail', pulse: false, wantsYou: false },
  unknown_outcome: { word: 'Outcome unknown', tone: 'fail', pulse: false, wantsYou: true },
  skipped: { word: 'Already done', tone: 'neutral', pulse: false, wantsYou: false },
  stopped: { word: 'Stopped', tone: 'neutral', pulse: false, wantsYou: false },
};

/** The batch's counts in the order a person reads them: what needs them first, then what is moving, then what is settled. */
const COUNT_ORDER: ReadonlyArray<{ status: RoutineRunStatus; word: string }> = [
  { status: 'waiting', word: 'waiting on you' },
  { status: 'escalated', word: 'escalated' },
  { status: 'unknown_outcome', word: 'to check' },
  { status: 'running', word: 'running' },
  { status: 'queued', word: 'queued' },
  { status: 'done', word: 'done' },
  { status: 'failed', word: 'failed' },
  { status: 'skipped', word: 'already done' },
  { status: 'stopped', word: 'stopped' },
];

/**
 * The batch's counts as chips: one per status that has runs, needs-you first.
 * @param counts - Runs per status.
 */
export function countChips(counts: Partial<Record<RoutineRunStatus, number>>): Array<{ status: RoutineRunStatus; n: number; word: string; tone: RoutineTone; pulse: boolean }> {
  return COUNT_ORDER.flatMap(({ status, word }) => {
    const n = counts[status] ?? 0;
    return n > 0 ? [{ status, n, word, tone: RUN_STATUS[status].tone, pulse: RUN_STATUS[status].pulse }] : [];
  });
}

/**
 * The batch in one line: "7 of 10 done · 1 waiting on you · 1 escalated".
 * @param counts - Runs per status.
 * @param total - Runs in the batch.
 */
export function batchProgress(counts: Partial<Record<RoutineRunStatus, number>>, total: number): string {
  const done = counts.done ?? 0;
  const rest = countChips(counts).filter(c => c.status !== 'done' && c.status !== 'queued' && c.status !== 'running').map(c => `${c.n} ${c.word}`);
  return [`${done} of ${total} done`, ...rest].join(' · ');
}

/**
 * How many runs a person is holding up.
 * @param counts - Runs per status.
 */
export function needsYou(counts: Partial<Record<RoutineRunStatus, number>>): number {
  return (counts.waiting ?? 0) + (counts.escalated ?? 0) + (counts.unknown_outcome ?? 0);
}

/**
 * A duration as a person says it: "42s", "3m 05s", "1h 02m".
 * @param ms - Milliseconds.
 */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  }
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * The time between two moments, or from one until now.
 * @param from - ISO start, or null when it has not started.
 * @param to - ISO end, or null while it runs.
 * @param now - Now, in ms.
 */
export function span(from: string | null, to: string | null, now: number): number | null {
  if (!from) {
    return null;
  }
  const a = Date.parse(from);
  const b = to ? Date.parse(to) : now;
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null;
}

/**
 * Money from cents: "$0.42".
 * @param cents - Cents.
 */
export function money(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

/**
 * Time people spent, in minutes: "3 min", "under a minute", "none".
 * @param ms - Milliseconds.
 */
export function peopleTime(ms: number): string {
  if (ms <= 0) {
    return 'none';
  }
  const m = ms / 60_000;
  if (m < 1) {
    return 'under a minute';
  }
  return m < 90 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`;
}

/**
 * Minutes as hours and minutes: 125 → "2 h 05 min".
 * @param minutes - Minutes.
 */
export function minutesLong(minutes: number): string {
  const m = Math.round(minutes);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** The most rows one request may start. */
const MAX_ROWS = ROUTINE_LIMITS.batchRows;

/**
 * A column name as a key: "Client name" and "client_name" are the same input.
 * @param s
 */
function keyOf(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/\W/g, '');
}

/**
 * One delimited line, honouring double quotes ("a, b" is one cell; "" is a quote).
 * @param line - The line.
 * @param sep - The delimiter.
 */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"' && cur.trim() === '') {
      quoted = true;
      cur = '';
    } else if (ch === sep) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export type ParsedRows = {
  rows: Array<Record<string, string>>;
  /** What is wrong, in a sentence a person can fix. Null when the rows can run. */
  error: string | null;
  /** The columns read, as input names. */
  columns: string[];
};

/**
 * The rows a person pasted, as the run route takes them: one object per row,
 * keyed by the routine's input names. A JSON array of objects, or lines of CSV
 * or TSV under a header line naming the inputs (case, spaces and dashes do not
 * matter). A routine with one plain input takes bare lines, one value each.
 * An input with no column is the same for every row (the campaign, the sign-in): the form asks for
 * it once and sends it as `shared`. Secret inputs are never columns.
 * @param text - What was pasted.
 * @param inputs - The routine's inputs.
 */
export function parseRows(text: string, inputs: readonly RoutineInputSpec[]): ParsedRows {
  const plain = inputs.filter(i => !i.secret);
  const byKey = new Map(plain.map(i => [keyOf(i.name), i.name]));
  const trimmed = text.trim();
  if (!trimmed) {
    return { rows: [], error: null, columns: [] };
  }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseJsonRows(trimmed, plain, byKey);
  }
  const lines = trimmed.split(/\r?\n/).filter(l => l.trim() !== '');
  const head = lines[0]!;
  const sep = head.includes('\t') ? '\t' : head.includes(',') ? ',' : head.includes(';') ? ';' : '\t';
  const header = cells(head, sep);
  const mapped = header.map(h => byKey.get(keyOf(h)) ?? null);
  if (mapped.every(m => m === null)) {
    // No header: a one-input routine reads every line as that input.
    if (plain.length === 1) {
      const name = plain[0]!.name;
      const rows = lines.map(l => ({ [name]: l.trim() }));
      return capped({ rows, error: null, columns: [name] });
    }
    return { rows: [], error: `Start with a header line naming the inputs: ${plain.map(i => i.name).join(', ')}.`, columns: [] };
  }
  const unknown = header.filter((h, i) => mapped[i] === null && h !== '');
  if (unknown.length > 0) {
    return { rows: [], error: `Not an input of this routine: ${unknown.join(', ')}. Its inputs are ${plain.map(i => i.name).join(', ')}.`, columns: [] };
  }
  const columns = mapped.filter((m): m is string => m !== null);
  const rows: Array<Record<string, string>> = [];
  for (const [n, line] of lines.slice(1).entries()) {
    const values = cells(line, sep);
    if (values.length > header.length) {
      return { rows: [], error: `Row ${n + 1} has ${values.length} cells and the header has ${header.length}. Quote a value that holds a "${sep === '\t' ? 'tab' : sep}".`, columns };
    }
    const row: Record<string, string> = {};
    mapped.forEach((name, i) => {
      if (name) {
        row[name] = values[i] ?? '';
      }
    });
    rows.push(row);
  }
  if (rows.length === 0) {
    return { rows: [], error: 'Add a row under the header.', columns };
  }
  return capped({ rows, error: null, columns });
}

function parseJsonRows(text: string, plain: readonly RoutineInputSpec[], byKey: Map<string, string>): ParsedRows {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], error: 'That is not valid JSON. Paste an array of objects, or CSV with a header line.', columns: [] };
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (!list.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
    return { rows: [], error: 'Each row should be an object, keyed by input name.', columns: [] };
  }
  const columns = new Set<string>();
  const rows: Array<Record<string, string>> = [];
  for (const item of list as Array<Record<string, unknown>>) {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(item)) {
      const name = byKey.get(keyOf(k));
      if (!name) {
        return { rows: [], error: `Not an input of this routine: ${k}. Its inputs are ${plain.map(i => i.name).join(', ')}.`, columns: [] };
      }
      columns.add(name);
      row[name] = v === null || v === undefined ? '' : typeof v === 'string' ? v.trim() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    rows.push(row);
  }
  return capped({ rows, error: null, columns: [...columns] });
}

function capped(p: ParsedRows): ParsedRows {
  if (p.rows.length > MAX_ROWS) {
    return { ...p, error: `One batch runs at most ${MAX_ROWS} rows; this is ${p.rows.length}.` };
  }
  const blank = p.rows.findIndex(r => Object.values(r).every(v => v === ''));
  if (blank >= 0) {
    return { ...p, error: `Row ${blank + 1} is empty.` };
  }
  return p;
}

/**
 * What to paste, from the inputs' examples: a header line and one row, as CSV.
 * @param inputs - The routine's inputs.
 */
export function exampleRows(inputs: readonly RoutineInputSpec[]): string {
  const plain = inputs.filter(i => !i.secret);
  const quote = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = plain.map(i => i.name).join(',');
  const row = plain.map(i => quote(i.example ?? '')).join(',');
  return plain.some(i => i.example) ? `${header}\n${row}` : header;
}

/**
 * How long ago, as a person says it: "just now", "3 min ago", "2 h ago", or the date.
 * @param iso - When.
 * @param now - Now, in ms.
 */
export function ago(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) {
    return '';
  }
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) {
    return 'just now';
  }
  if (s < 3600) {
    return `${Math.max(1, Math.round(s / 60))} min ago`;
  }
  if (s < 86_400) {
    return `${Math.round(s / 3600)} h ago`;
  }
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
