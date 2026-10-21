/**
 * A BROWSER RUN, as every surface reads it — the row, the tool's answer, the
 * pane. Pure and client-safe: the server writes these shapes
 * (`services/browser/BrowserRunService.ts`), the pane polls them
 * (`features/browser/BrowserRunView.tsx`).
 *
 * A browser run is a run, the third kind beside an engineering run and an
 * agent run: a task, the inputs it was given, the outputs it owes, and what
 * it did, step by step, with its result. It maps onto the run noun rather
 * than adding one (Principle 7).
 */

/**
 * `proposed`: suggested by an agent, waiting for the person's Start.
 * `queued` → `running` → `done` | `failed` | `stopped`.
 * `waiting`: paused on the person — an approval before a step that submits,
 * sends, pays or deletes, or a question only they can answer.
 */
export const BROWSER_RUN_STATUSES = ['proposed', 'queued', 'running', 'waiting', 'done', 'failed', 'stopped'] as const;
export type BrowserRunStatus = (typeof BROWSER_RUN_STATUSES)[number];

/** A run that holds the person's browser: one at a time per person. */
const LIVE_STATUSES: ReadonlySet<BrowserRunStatus> = new Set(['queued', 'running', 'waiting']);

export function isLive(status: string): boolean {
  return LIVE_STATUSES.has(status as BrowserRunStatus);
}

/** One output the run owes, by name, with what it means. */
export type BrowserOutputSpec = { name: string; description: string };

/** One input, as stored and shown. A secret's value is never stored: it reads `••••`. */
export type BrowserInput = { value: string; secret?: boolean };

/** One thing the browser did. */
export type BrowserStep = {
  n: number;
  at: string;
  /** `open`, `click`, `type`, `press`, `scroll`, `wait`, `approval`, `ask`, `finish`, `note`. */
  kind: string;
  /** In a person's words: "Clicked “Sign in”". */
  label: string;
  /** Why the browser did it, in one line, from the model. */
  why?: string;
  url?: string;
  ok: boolean;
  detail?: string;
};

/** What the run is waiting on the person for. */
export type BrowserWaiting = {
  kind: 'approval' | 'question';
  /** What the browser wants to do, or what it asks. */
  text: string;
  /** For an approval: the step it will take when approved. */
  step?: string;
  /** A screenshot of the page as it stood when it stopped. */
  shotUrl?: string;
  at: string;
};

/** The run as the pane draws it. */
export type BrowserRunView = {
  id: number;
  status: BrowserRunStatus;
  task: string;
  startUrl: string | null;
  inputs: Record<string, BrowserInput>;
  outputs: BrowserOutputSpec[];
  result: Record<string, unknown> | null;
  summary: string | null;
  steps: BrowserStep[];
  waiting: BrowserWaiting | null;
  error: string | null;
  /** Where the page is now (live), or was when it ended. */
  url: string | null;
  title: string | null;
  /** Bumped on every new frame while live: the pane reloads the picture when it moves. */
  frameSeq: number;
  /** True while this process holds the browser, so the picture is live. */
  live: boolean;
  finalShotUrl: string | null;
  proposedBy: string;
  agentSlug: string | null;
  conversationId: number | null;
  cents: number;
  /** Where the browser ran: `remote` (its own container), `sandboxed`, `unsandboxed`; null before it opened. */
  isolation: string | null;
  /** How many times it was picked up again after the app restarted. */
  resumes: number;
  /** Its process went away and it is about to be picked up again. */
  resuming: boolean;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

/** The limits on one run. */
export const BROWSER_RUN_LIMITS = {
  /** Model steps a run may take before it stops and says what it has. */
  steps: 40,
  /** Wall clock for a run, not counting time waiting on the person. */
  runMs: 8 * 60_000,
  /** How long a run waits on the person before it stops. */
  waitMs: 30 * 60_000,
  /** The person's browser closes this long after its last run ended. */
  idleMs: 20 * 60_000,
  /** Characters of page snapshot the model reads in one step. */
  snapshotChars: 10_000,
} as const;

/**
 * The label a run goes by in chat and in the pane.
 * @param id
 */
export function browserRunLabel(id: number | string): string {
  return `Browser run ${id}`;
}

/** The secret's mask, as shown. */
export const SECRET_MASK = '••••';

/**
 * The words a click or a key press may not take without the person's
 * approval: the button names of steps that change something outside —
 * submit, send, pay, delete. Enforced by the engine, outside the model, so a
 * page that talks the model into "click Pay" still stops here.
 */
const CONSEQUENTIAL = /\b(?:submit|send|pay|pay now|purchase|buy|place order|checkout|check out|confirm|delete|remove|transfer|publish|post|approve|save|update|sign contract)\b/i;

/**
 * Whether a step on this element needs the person's approval first: a button
 * (or a submit input) whose name says it changes something. A link never
 * does — "Order history" is a place, not an order.
 * @param el - The element's role and accessible name.
 * @param el.role - `button`, `link`, `textbox`, …
 * @param el.name - What it says.
 */
export function needsApproval(el: { role: string | null; name: string | null }): boolean {
  return el.role === 'button' && Boolean(el.name && CONSEQUENTIAL.test(el.name));
}
