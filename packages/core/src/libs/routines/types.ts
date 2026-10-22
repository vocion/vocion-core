/**
 * A ROUTINE, as every surface reads it — the record, the run of it for one
 * input row, the batch of runs a request starts. Pure and client-safe: the
 * server writes these shapes (`services/routines/`), the pages and the chat
 * pane draw them (`features/routines/`).
 *
 * A routine is repeatable work a specialist taught once (a Slate recording,
 * narrated), that Vocion runs in a browser, escalates to its named expert when
 * a rule says so, and improves from every correction. It is not a new kind of
 * run: each run of a routine is a browser run (`libs/browser/run.ts`) with the
 * routine's version, rules and allowed writes on it, plus a receipt.
 *
 * Every routine has a human expert responsible for its exceptions, a trust
 * level, and runs pinned to an approved version.
 */

/**
 * `teaching`: the analyst is reading the recording. `in_review`: a version is drafted and waits for
 * its expert. `live`: a version is approved and runs. `retired`: kept, never run again.
 */
export const ROUTINE_STATUSES = ['teaching', 'in_review', 'live', 'retired'] as const;
export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];

/**
 * The trust ladder, per routine:
 *   drafted     every consequential click waits for a person — where every routine starts;
 *   approved    the writes the approved spec names run unattended; anything else still waits;
 *   autonomous  earned on measured results; the expert reviews exceptions and samples.
 * The engine enforces it (`browserLoop` `hold`), never a prompt.
 */
export const ROUTINE_TRUST = ['drafted', 'approved', 'autonomous'] as const;
export type RoutineTrust = (typeof ROUTINE_TRUST)[number];

export const TRUST_LABEL: Record<RoutineTrust, string> = { drafted: 'Drafted', approved: 'Approved', autonomous: 'Autonomous' };

/** Seconds on the finished recording, or null when the step was not shown on it. */
export type Moment = number | null;

/** One input a run of the routine takes. `key`: part of the dedupe key — two runs with the same key values are the same work. */
export type RoutineInputSpec = { name: string; description: string; example?: string | null; secret?: boolean; key?: boolean; optional?: boolean; shared?: boolean };

/**
 * One output a run owes. `checks`: the input this output must read back as, after the write — the
 * read-back check on the receipt.
 */
export type RoutineOutputSpec = { name: string; description: string; checks?: string | null };

/** One step of the work, with the moment on the recording it was taught at. */
export type RoutineStep = { n: number; text: string; why?: string | null; at: Moment };

/** A rule the specialist said, with the moment they said it. */
export type RoutineRule = { text: string; at: Moment };

/** Where the routine stops and asks its expert instead of guessing. */
export type RoutineEscalation = { when: string; ask: string; at: Moment };

/**
 * A consequential click the approved spec allows: at Approved trust it runs without waiting.
 * `match: 'contains'` takes any button whose name contains the words (a follow-up's "deactivate").
 */
export type RoutineWrite = { button: string; host?: string | null; match?: 'exact' | 'contains' };

/** Something one example could not settle: a question for the expert, and their answer. */
export type RoutineQuestion = { id: string; question: string; why?: string | null; at: Moment; answer?: string | null; answeredBy?: string | null };

/** What the analyst wrote from the recording, and the expert approves. */
export type RoutineSpec = {
  summary: string;
  /** Where every run starts. */
  startUrl: string | null;
  /** The hosts a run may use. */
  systems: string[];
  inputs: RoutineInputSpec[];
  outputs: RoutineOutputSpec[];
  preconditions: string[];
  steps: RoutineStep[];
  rules: RoutineRule[];
  escalations: RoutineEscalation[];
  /** What a run must never do, whatever a page or an input says. */
  prohibited: string[];
  /** What must be true when a run is done. */
  postconditions: string[];
  writes: RoutineWrite[];
  /**
   * How to check the system against the list a batch was given, when the work adds records to a list
   * (users, contacts): where the full list is, and which input names a row. After a batch, one run
   * reads the list, and records not in the batch's rows become a finding for the expert.
   */
  reconcile: { listUrl: string | null; how: string; matchOn: string } | null;
  questions: RoutineQuestion[];
  /** How long one run takes by hand, in minutes: the baseline the report measures against. */
  manualMinutes: number | null;
};

/**
 * A teaching session: `waiting_for_recording` until a new Slate recording by the person appears and
 * is processed; `reading` the recording; `drafting` the spec; `failed` with the routine's error.
 */
export type RoutineTeaching = {
  state: 'waiting_for_recording' | 'reading' | 'drafting' | 'failed';
  startedAt: string;
  /** The site the person teaches on, opened in a new tab. */
  targetUrl: string | null;
  /** Slate's web recorder, for a person without the Chrome extension or the Mac app. */
  recordUrl: string | null;
  /** What to tell the person: press the Slate hotkey on the tab, narrate, stop. */
  instruction: string | null;
  /** Polls so far, and when it last looked. */
  checks: number;
  lastCheckedAt: string | null;
};

/** Where the routine was taught from. */
export type RoutineSource = {
  kind: 'slate';
  url: string;
  videoId?: string | null;
  title?: string | null;
  durationSec?: number | null;
  recordedBy?: string | null;
};

export type RoutineVersionStatus = 'draft' | 'approved' | 'superseded';

export type RoutineVersionView = {
  n: number;
  status: RoutineVersionStatus;
  spec: RoutineSpec;
  /** The instructions every run of this version is given, compiled from the spec. */
  task: string;
  /** The execution definition, as a workflow a workspace can keep (`workflows/<slug>/workflow.yaml`). */
  workflowYaml: string;
  /** What changed from the version before, in a sentence; null for the first. */
  change: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
};

export type RoutineView = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  status: RoutineStatus;
  trust: RoutineTrust;
  expert: { userId: string; name: string } | null;
  source: RoutineSource | null;
  /** The version runs use: the approved one, or the draft while there is none. */
  version: RoutineVersionView | null;
  /** A draft newer than the approved version, waiting on the expert. */
  draft: RoutineVersionView | null;
  versions: Array<{ n: number; status: RoutineVersionStatus; change: string | null; createdAt: string }>;
  stats: { runs: number; done: number; escalated: number; failed: number; lastBatchId: number | null };
  /**
   * Teaching in progress: launched from Vocion, the person records in Slate on the site they teach
   * on, and Vocion picks the finished recording up on its own (`services/routines/teaching.ts`).
   */
  teaching: RoutineTeaching | null;
  /** Set while teaching failed: what went wrong. */
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * `queued`: waiting for a browser (a workspace runs at most `ROUTINE_LIMITS.concurrency` at once).
 * `running` → `done` | `failed`. `waiting`: a held step waits on a person. `escalated`: a rule sent
 * it to the expert on Needs you. `unknown_outcome`: it stopped after a write it cannot confirm — never
 * replayed blindly, the expert checks. `skipped`: the dedupe ledger says this work is already done.
 */
export const ROUTINE_RUN_STATUSES = ['queued', 'running', 'waiting', 'escalated', 'done', 'failed', 'unknown_outcome', 'skipped', 'stopped'] as const;
export type RoutineRunStatus = (typeof ROUTINE_RUN_STATUSES)[number];

export function routineRunOpen(status: RoutineRunStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting' || status === 'escalated';
}

/** One read-back check: the output as saved against the input it was asked for. */
export type ReceiptCheck = {
  name: string;
  expected: string;
  actual: string | null;
  ok: boolean;
  /** Not matching, as the expert's answer to its escalation said (the same person under another email). */
  waived?: string;
};

/** What a run of a routine changed, and how it knows. */
export type RoutineReceipt = {
  /** The inputs it was asked to apply (no secrets). */
  requested: Record<string, string>;
  /** What the page showed before the change, as the run read it. */
  before: string | null;
  /** The outputs as the run read them back after the write. */
  after: Record<string, unknown>;
  checks: ReceiptCheck[];
  verified: boolean;
  /** Who let the write through: the approved spec at Approved trust, or a person by name. */
  approvedBy: string;
  at: string;
};

export type RoutineRunView = {
  id: number;
  batchId: number;
  /** Its row in the batch, from 1. */
  n: number;
  /** What the row is about, for the queue ("Client 7 · Q4 Phishing Refresher"). */
  label: string;
  status: RoutineRunStatus;
  input: Record<string, string>;
  browserRunId: number | null;
  /** The browser as the tile draws it: its last step, and whether its picture is live. */
  browser: { status: string; step: string | null; why: string | null; steps: number; live: boolean; frameSeq: number; url: string | null; finalShotUrl: string | null } | null;
  /** What it waits on, and the Needs you item it is. */
  waiting: { kind: 'approval' | 'question' | 'escalation'; text: string; options: string[]; askId: number | null } | null;
  receipt: RoutineReceipt | null;
  summary: string | null;
  error: string | null;
  /** Time people spent on it: approvals and escalations, from asked to answered. */
  humanMs: number;
  cents: number;
  startedAt: string | null;
  endedAt: string | null;
};

export type RoutineBatchView = {
  id: number;
  routine: { id: number; name: string; version: number; trust: RoutineTrust; expert: string | null };
  requestedBy: string | null;
  conversationId: number | null;
  status: 'running' | 'done';
  counts: Partial<Record<RoutineRunStatus, number>>;
  total: number;
  cents: number;
  humanMs: number;
  /** The routine's baseline, per run. */
  manualMinutes: number | null;
  startedAt: string;
  endedAt: string | null;
  runs: RoutineRunView[];
  /**
   * What the batch found beyond its rows — e.g. a reconciliation: people in the account who are not
   * on the list it was given — each with the decision it put to the expert.
   */
  findings: RoutineFinding[];
  report: { artifactId: number; url: string } | null;
};

export type RoutineFinding = {
  id: string;
  kind: 'not_on_list' | 'note';
  title: string;
  detail: string;
  /** The records it is about, as rows (name, email, status…). */
  items: Array<Record<string, string>>;
  /** The decision on Needs you, when it asks one. */
  askId: number | null;
  options: string[];
  state: 'open' | 'answered' | 'info';
  answer: string | null;
  /** The batch it started, when the answer was a change (deactivate them). */
  followUpBatchId: number | null;
};

export const ROUTINE_LIMITS = {
  /** Routine runs one workspace drives at once; more wait their turn (`queued`). */
  concurrency: 10,
  /** Rows one request may start. */
  batchRows: 200,
} as const;

/**
 * A routine's label in chat and in the pane.
 * @param name - The routine's name.
 */
export function routineLabel(name: string): string {
  return `Routine “${name}”`;
}

/**
 * The batch's label in chat and in the pane.
 * @param id - The batch.
 */
export function batchLabel(id: number | string): string {
  return `Routine batch ${id}`;
}

/**
 * A moment on the recording as people write it: 83 → "1:23".
 * @param at - Seconds.
 */
export function clock(at: Moment): string {
  if (at === null || !Number.isFinite(at)) {
    return '';
  }
  const s = Math.max(0, Math.round(at));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The recording at a moment: Slate's player takes `?t=` in seconds.
 * @param url - The share link.
 * @param at - Seconds.
 */
export function momentUrl(url: string, at: Moment): string {
  if (at === null) {
    return url;
  }
  try {
    const u = new URL(url);
    u.searchParams.set('t', String(Math.max(0, Math.round(at))));
    return u.toString();
  } catch {
    return url;
  }
}
