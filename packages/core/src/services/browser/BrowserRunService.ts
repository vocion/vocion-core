/**
 * BROWSER RUNS: a task handed to a browser, as a run — the row
 * (`browser_run`), the person's browser it runs in (`browserEngine.ts`, on
 * the host `browserHost.ts` picks) and the loop that drives it
 * (`browserLoop.ts`).
 *
 * Who starts one. A person who asks for it in their own words, or tags
 * `@browser`: the run starts at once, as theirs. An agent that thinks a task
 * needs a browser: the run is `proposed`, and starts when the person presses
 * Start on it. The same rule as every other action (`turnJudge.saidToDecide`).
 *
 * One live run per person at a time (`BrowserRunBusyError`), in one browser
 * that stays open between their runs, so the next task can carry on from the
 * page the last one left. A run of a routine (`routineRunId`) is not the
 * person's: it runs beside the routine's other runs in a browser of its own
 * (`sessionKeyOf`), under the routine's version, rules and trust level, and
 * tells the routine (`services/routines/RoutineService.ts`) when it waits and
 * when it ends — the routine, not the run, speaks in the conversation.
 *
 * Where the result goes: on the run, always; to the tool call that started
 * it when that call is still waiting; otherwise into the conversation it was
 * asked from, as one message — done, failed, or waiting on the person.
 *
 * A RUN OUTLIVES THE PROCESS DRIVING IT. The process beats the row's
 * `heartbeat_at` every few seconds and seals a checkpoint after each step:
 * the browser's cookies, site storage and page, the run's notes and its
 * secrets, under the workspace's key. When the beat stops (a deploy, a
 * crash), the next process to look (`startBrowserRunKeeper`, every few
 * seconds from boot) claims the run, opens a browser from the checkpoint and
 * carries on, told what it had done. A run waiting on the person waits again,
 * with the same Approve and Decline, and an approval given meanwhile is taken
 * without asking twice. After three such restarts it stops and says so.
 */

import type { SavedBrowser } from './browserEngine';
import type { BrowserInput, BrowserOutputSpec, BrowserRunStatus, BrowserRunView, BrowserStep, BrowserWaiting } from '@/libs/browser/run';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import process from 'node:process';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { asRootRun } from '@/libs/agents/rootRun';
import { BROWSER_RUN_LIMITS, browserRunLabel, isLive, SECRET_MASK } from '@/libs/browser/run';
import { db } from '@/libs/DB';
import { browserRunSchema } from '@/models/Schema';
import { claim, closeBrowserSession, existingSession, openBrowserSession, releaseBrowserSession, saveBrowser, screenshot, sessionKeyOf } from './browserEngine';
import { isStale, STALE_MS, toView } from './runReads';

type Row = typeof browserRunSchema.$inferSelect;

/** This process, as it signs the runs it drives. */
const RUNNER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
/** How often a driven run's beat is written, and how old a beat is before the run counts as abandoned. */
const BEAT_MS = 8_000;
/** Restarts a run survives before it stops and says so. */
const MAX_RESUMES = 3;
/** The least time between two checkpoints of one run. */
const CHECKPOINT_MS = 3_000;

/** The person's browser is already running a task. */
export class BrowserRunBusyError extends Error {
  constructor(public readonly runId: number, task: string) {
    super(`your browser is busy with ${browserRunLabel(runId)} (“${task.slice(0, 80)}”). Stop it or wait for it to finish.`);
  }
}

/** A request about a run this person may not act on, or that is not in that state. */
export class BrowserRunError extends Error {}

type Answer = { kind: 'approved' } | { kind: 'denied'; note?: string } | { kind: 'answer'; text: string } | { kind: 'stopped' } | { kind: 'timeout' };

/** What a checkpoint holds, sealed. */
type Checkpoint = { secrets: Record<string, string>; notes: string[]; browser: SavedBrowser | null };

/** Where a resumed run picks up. */
type Resume = { browser: SavedBrowser | null; notes: string[]; waiting: BrowserWaiting | null };

type Live = {
  id: number;
  orgId: string;
  userId: string;
  key: string;
  stop: boolean;
  /** The person's pending answer to a wait. */
  answer: ((a: Answer) => void) | null;
  secrets: Record<string, string>;
  notes: string[];
  steps: BrowserStep[];
  /** A tool call is waiting on this run: it hands the result over, so the run does not also post it. */
  heldByCall: number;
  /** Who is waiting for the next change of state. */
  listeners: Set<() => void>;
  beat: ReturnType<typeof setInterval> | null;
  lastCheckpoint: number;
};

// On the process, not the module (`browserEngine` sessions): an answer always reaches the loop that waits for it.
const live: Map<number, Live> = ((globalThis as { __vocionBrowserLive?: Map<number, Live> }).__vocionBrowserLive ??= new Map());

function notify(l: Live): void {
  for (const f of l.listeners) {
    f();
  }
  pushLive(l.orgId, l.id);
}

const lastPush = new Map<number, number>();

/**
 * Say on the live stream that the run moved (the follow chip's dot), at most a few times a second.
 * @param orgId - The workspace.
 * @param id - The run.
 */
function pushLive(orgId: string, id: number): void {
  const now = Date.now();
  if (now - (lastPush.get(id) ?? 0) < 400) {
    return;
  }
  lastPush.set(id, now);
  void import('@/libs/live/publish').then(m => m.publish({ orgId, topics: [`browser:${id}`], ref: `browser:${id}`, kind: 'changed' })).catch(() => {});
}

async function patch(id: number, values: Partial<typeof browserRunSchema.$inferInsert>): Promise<void> {
  await db.update(browserRunSchema).set({ ...values, updatedAt: new Date() }).where(eq(browserRunSchema.id, id));
}

async function seal(orgId: string, c: Checkpoint) {
  const { buildCredentialVault } = await import('@/libs/crypto/credentialVault');
  return buildCredentialVault().encrypt(orgId, Buffer.from(JSON.stringify(c), 'utf8'));
}

async function unseal(row: Row): Promise<Checkpoint | null> {
  if (!row.checkpoint) {
    return null;
  }
  try {
    const { buildCredentialVault } = await import('@/libs/crypto/credentialVault');
    const c = row.checkpoint;
    return JSON.parse((await buildCredentialVault().decrypt(row.orgId, c.ciphertext, c.nonce, c.authTag, c.dekId)).toString('utf8')) as Checkpoint;
  } catch (e) {
    console.warn('[browser] a checkpoint could not be opened', { run: row.id, reason: (e as Error).message });
    return null;
  }
}

async function readRow(orgId: string, id: number): Promise<Row | null> {
  const [row] = await db.select().from(browserRunSchema).where(and(eq(browserRunSchema.orgId, orgId), eq(browserRunSchema.id, id))).limit(1);
  if (row && isLive(row.status) && !live.has(row.id) && isStale(row)) {
    // Abandoned by the process that drove it: pick it up here, now, rather than at the next sweep.
    void adopt(row.id);
  }
  return row ?? null;
}

/**
 * A run as the pane draws it, or null when this workspace has no such run.
 * @param orgId - The workspace.
 * @param id - The run.
 */
export async function getBrowserRun(orgId: string, id: number): Promise<BrowserRunView | null> {
  const row = await readRow(orgId, id);
  return row ? toView(row) : null;
}

/**
 * The person's live run, when they have one — driven here, elsewhere, or about to be picked up.
 * @param orgId - The workspace.
 * @param userId - The person.
 */
export async function liveRunFor(orgId: string, userId: string): Promise<{ id: number; task: string } | null> {
  // A routine's runs are not in the person's browser, so they never make it busy.
  const [r] = await db.select({ id: browserRunSchema.id, task: browserRunSchema.task }).from(browserRunSchema).where(and(eq(browserRunSchema.orgId, orgId), eq(browserRunSchema.userId, userId), isNull(browserRunSchema.routineRunId), inArray(browserRunSchema.status, ['queued', 'running', 'waiting']))).orderBy(desc(browserRunSchema.id)).limit(1);
  return r ?? null;
}

export type CreateBrowserRun = {
  orgId: string;
  userId: string;
  conversationId?: number | null;
  agentSlug?: string | null;
  task: string;
  startUrl?: string | null;
  /** Name → value. */
  inputs?: Record<string, string>;
  /** Which inputs are secrets: sealed for the run's life, shown as `••••`, never read by the model. */
  secretNames?: string[];
  outputs?: BrowserOutputSpec[];
  /** `person` when they asked for it; `agent:<slug>` when suggested. */
  proposedBy: string;
  /** Start now (the person asked) or wait for their Start (suggested). */
  start: boolean;
  /** Carry on from the page the person's browser is on, instead of opening `startUrl`. */
  continuing?: boolean;
  /** A run of a routine: its own browser, the routine's rules and trust (`services/routines/`). */
  routineRunId?: number | null;
};

/**
 * File a run, and start it when the person asked for it.
 * @param input - The run.
 */
export async function createBrowserRun(input: CreateBrowserRun): Promise<BrowserRunView> {
  if (input.start && !input.routineRunId) {
    const busy = await liveRunFor(input.orgId, input.userId);
    if (busy) {
      throw new BrowserRunBusyError(busy.id, busy.task);
    }
  }
  const secretNames = new Set(input.secretNames ?? []);
  const stored: Record<string, BrowserInput> = {};
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.inputs ?? {})) {
    if (secretNames.has(k)) {
      stored[k] = { value: SECRET_MASK, secret: true };
      secrets[k] = v;
    } else {
      stored[k] = { value: v };
    }
  }
  // Sealed from the start, so a suggestion's Start and a restarted run both still have them.
  const checkpoint = Object.keys(secrets).length > 0 ? await seal(input.orgId, { secrets, notes: [], browser: null }) : null;
  const [row] = await db.insert(browserRunSchema).values({
    orgId: input.orgId,
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    agentSlug: input.agentSlug ?? null,
    status: input.start ? 'queued' : 'proposed',
    task: input.task.trim(),
    startUrl: input.startUrl?.trim() || null,
    inputs: stored,
    outputs: input.outputs ?? [],
    proposedBy: input.proposedBy,
    checkpoint,
    routineRunId: input.routineRunId ?? null,
    ...(input.start ? { runnerId: RUNNER_ID, heartbeatAt: new Date() } : {}),
  }).returning();
  if (input.start) {
    begin(row!, secrets, input.continuing ?? false, null);
    return toView(row!);
  }
  return toView(row!);
}

/**
 * Start a suggested run: the person's Start.
 * @param orgId - The workspace.
 * @param userId - The person pressing Start; only the run's own person may.
 * @param id - The run.
 */
export async function startBrowserRun(orgId: string, userId: string, id: number): Promise<BrowserRunView> {
  const row = await readRow(orgId, id);
  if (!row || row.userId !== userId) {
    throw new BrowserRunError('No such run of yours.');
  }
  if (row.status !== 'proposed') {
    throw new BrowserRunError(`${browserRunLabel(id)} is ${row.status}, not waiting to start.`);
  }
  const busy = await liveRunFor(orgId, userId);
  if (busy) {
    throw new BrowserRunBusyError(busy.id, busy.task);
  }
  const secrets = (await unseal(row))?.secrets ?? {};
  const owed = Object.entries(row.inputs ?? {}).filter(([, v]) => v.secret).map(([k]) => k).filter(k => !(k in secrets));
  if (owed.length > 0) {
    throw new BrowserRunError(`The secret input${owed.length > 1 ? 's' : ''} ${owed.join(', ')} could not be read back. Ask for the run again.`);
  }
  // Claimed in one write: a second Start, or a second process, finds it no longer proposed.
  const [claimed] = await db.update(browserRunSchema).set({ status: 'queued', runnerId: RUNNER_ID, heartbeatAt: new Date(), updatedAt: new Date() }).where(and(eq(browserRunSchema.id, id), eq(browserRunSchema.status, 'proposed'))).returning();
  if (!claimed) {
    throw new BrowserRunError(`${browserRunLabel(id)} has already been started.`);
  }
  begin(claimed, secrets, false, null);
  return toView(claimed);
}

/**
 * The person's Stop.
 * @param orgId - The workspace.
 * @param userId - The person.
 * @param id - The run.
 */
export async function stopBrowserRun(orgId: string, userId: string, id: number): Promise<void> {
  const row = await readRow(orgId, id);
  if (!row || row.userId !== userId) {
    throw new BrowserRunError('No such run of yours.');
  }
  const l = live.get(id);
  if (row.status === 'proposed' || (isLive(row.status) && !l)) {
    // Not started, or driven by no process right now: stopped where it stands.
    await patch(id, { status: 'stopped', endedAt: new Date(), summary: row.status === 'proposed' ? 'Not started.' : 'Stopped by the person.', waiting: null, checkpoint: null, runnerId: null });
    return;
  }
  if (!l) {
    return;
  }
  l.stop = true;
  l.answer?.({ kind: 'stopped' });
}

/**
 * The person's answer to what a run is waiting on: approve or decline the held step, or answer its question.
 * @param orgId - The workspace.
 * @param userId - The person; only the run's own person may answer.
 * @param id - The run.
 * @param decision - The answer.
 */
export async function answerBrowserRun(orgId: string, userId: string, id: number, decision: { kind: 'approve' } | { kind: 'deny'; note?: string } | { kind: 'answer'; text: string }): Promise<void> {
  const row = await readRow(orgId, id);
  if (!row || row.userId !== userId) {
    throw new BrowserRunError('No such run of yours.');
  }
  await answerRow(row, decision);
}

/**
 * A routine's answer to its run: the routine has already checked who may answer (its expert, or the
 * person who asked for the batch).
 * @param orgId - The workspace.
 * @param id - The run.
 * @param decision - The answer.
 */
export async function answerRoutineBrowserRun(orgId: string, id: number, decision: { kind: 'approve' } | { kind: 'deny'; note?: string } | { kind: 'answer'; text: string }): Promise<void> {
  const row = await readRow(orgId, id);
  if (!row?.routineRunId) {
    throw new BrowserRunError('No such run of a routine.');
  }
  await answerRow(row, decision);
}

/**
 * Stop a routine's run: the routine has already checked who may.
 * @param orgId - The workspace.
 * @param id - The run.
 */
export async function stopRoutineBrowserRun(orgId: string, id: number): Promise<void> {
  const row = await readRow(orgId, id);
  if (!row?.routineRunId) {
    return;
  }
  await stopBrowserRun(orgId, row.userId, id);
}

async function answerRow(row: Row, decision: { kind: 'approve' } | { kind: 'deny'; note?: string } | { kind: 'answer'; text: string }): Promise<void> {
  const id = row.id;
  const l = live.get(id);
  if (row.status !== 'waiting' || !l?.answer) {
    throw new BrowserRunError(row.status === 'waiting' ? `${browserRunLabel(id)} is being picked up again after a restart; answer it in a moment.` : `${browserRunLabel(id)} is not waiting on you.`);
  }
  const resolve = l.answer;
  l.answer = null;
  resolve(decision.kind === 'approve' ? { kind: 'approved' } : decision.kind === 'deny' ? { kind: 'denied', note: decision.note } : { kind: 'answer', text: decision.text });
}

/**
 * Wait until the run ends or stops on the person, or the time is up; then its view.
 * A caller that hands the result on (the tool) holds the run, so it does not also post it.
 * @param orgId - The workspace.
 * @param id - The run.
 * @param ms - The longest to wait.
 */
export async function waitForBrowserRun(orgId: string, id: number, ms: number): Promise<BrowserRunView | null> {
  const l = live.get(id);
  if (l) {
    l.heldByCall += 1;
    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          l!.listeners.delete(check);
          resolve();
        }
        async function check() {
          const [r] = await db.select({ status: browserRunSchema.status }).from(browserRunSchema).where(eq(browserRunSchema.id, id)).limit(1);
          if (!r || !['queued', 'running'].includes(r.status)) {
            done();
          }
        }
        l!.listeners.add(check);
        void check();
      });
    } finally {
      l.heldByCall -= 1;
    }
  }
  return getBrowserRun(orgId, id);
}

/**
 * Whether a tool call is waiting on this run and will hand its result on itself.
 * @param id - The run.
 */
export function heldByCall(id: number): boolean {
  return (live.get(id)?.heldByCall ?? 0) > 0;
}

async function keepShot(orgId: string, key: string): Promise<string | null> {
  try {
    const s = existingSession(key);
    if (!s) {
      return null;
    }
    const jpeg = await screenshot(s);
    const { saveArtifact } = await import('@/libs/tools/artifacts/store');
    const f = await saveArtifact({ orgId, data: jpeg, ext: 'jpg', contentType: 'image/jpeg' });
    return f.url;
  } catch {
    return null;
  }
}

/**
 * Seal where the run is: the browser, the notes, the secrets. At most every few seconds unless forced.
 * @param l - The run.
 * @param force - Write now (before a wait, which may outlast this process).
 */
async function checkpoint(l: Live, force = false): Promise<void> {
  if (!force && Date.now() - l.lastCheckpoint < CHECKPOINT_MS) {
    return;
  }
  l.lastCheckpoint = Date.now();
  try {
    const s = existingSession(l.key);
    const browser = s ? await saveBrowser(s) : null;
    await patch(l.id, { checkpoint: await seal(l.orgId, { secrets: l.secrets, notes: l.notes, browser }) });
  } catch (e) {
    console.warn('[browser] checkpoint not written', { run: l.id, reason: (e as Error).message });
  }
}

/**
 * Tell the routine a run of it moved: it waits, it carries on, it ended. Never throws.
 * @param row - The run.
 * @param event - What happened.
 */
function tellRoutine(row: Row, event: { kind: 'waiting'; waiting: BrowserWaiting } | { kind: 'running' } | { kind: 'ended'; status: BrowserRunStatus; summary: string; result: Record<string, unknown> | null; error: string | null; wroteAfterApproval: boolean }): void {
  if (!row.routineRunId) {
    return;
  }
  void import('@/services/routines/RoutineService')
    .then(m => m.onBrowserRunEvent(row.orgId, row.routineRunId!, row.id, event))
    .catch(e => console.warn('[routines] a run could not tell its routine', { run: row.id, reason: (e as Error).message }));
}

/**
 * Whether the run took a write a person or the routine let through: what it did then may have
 * changed something, so an ending it cannot account for is an unknown outcome, never a replay.
 * @param steps - Its steps.
 */
function wroteAfterApproval(steps: BrowserStep[]): boolean {
  return steps.some(s => s.kind === 'approval' && s.ok && /^(?:Approved by the person|Inside the routine)/.test(s.label));
}

function begin(row: Row, secrets: Record<string, string>, continuing: boolean, resume: Resume | null): void {
  const key = sessionKeyOf(row);
  const l: Live = { id: row.id, orgId: row.orgId, userId: row.userId, key, stop: false, answer: null, secrets, notes: resume?.notes ?? [], steps: [...(row.steps ?? [])], heldByCall: 0, listeners: new Set(), beat: null, lastCheckpoint: 0 };
  live.set(row.id, l);
  // The beat that says this process is driving it; a stopped beat lets another process pick it up.
  l.beat = setInterval(() => {
    // The beat also hears a Stop pressed where another process served the person.
    void db.update(browserRunSchema).set({ heartbeatAt: new Date(), runnerId: RUNNER_ID }).where(and(eq(browserRunSchema.id, row.id), inArray(browserRunSchema.status, ['queued', 'running', 'waiting']))).returning({ id: browserRunSchema.id }).then((r) => {
      if (r.length === 0 && !l.stop) {
        l.stop = true;
        l.answer?.({ kind: 'stopped' });
      }
    }).catch(() => {});
  }, BEAT_MS);
  l.beat.unref?.();
  // Its own root run: the chat turn that started it has its own callbacks and abort signal, and
  // neither may reach this loop (its text would stream into the chat; its end would abort the run).
  void asRootRun(() => drive(row, l, continuing, resume)).catch(async (e) => {
    if ((e as Error)?.name === 'BrowserLostError' || /Target (?:page, context or browser )?(?:has been )?closed|browser has been closed/i.test((e as Error)?.message ?? '')) {
      // The browser went away, not the task: the keeper picks the run up from its checkpoint.
      console.warn('[browser] the browser closed under a run; it will be picked up again', { run: row.id });
      await patch(row.id, { heartbeatAt: null, runnerId: null, steps: l.steps }).catch(() => {});
      return;
    }
    const error = e instanceof Error ? e.message.split('\n')[0]!.slice(0, 400) : String(e);
    await patch(row.id, { status: 'failed', error, waiting: null, endedAt: new Date(), steps: l.steps, checkpoint: null, runnerId: null }).catch(() => {});
    tellRoutine(row, { kind: 'ended', status: 'failed', summary: error, result: null, error, wroteAfterApproval: wroteAfterApproval(l.steps) });
    await announce(row, 'failed', `${browserRunLabel(row.id)} stopped: ${error}`).catch(() => {});
  }).finally(() => {
    if (l.beat) {
      clearInterval(l.beat);
    }
    live.delete(row.id);
    notify(l);
    if (row.routineRunId) {
      // A routine's run has a browser of its own, and nothing comes after it in that browser.
      void closeBrowserSession(key);
    } else {
      releaseBrowserSession(key);
    }
  });
}

/**
 * Wait on the person for a held step or a question; the answer, or a timeout.
 * @param l
 */
function awaitPerson(l: Live): Promise<Answer> {
  return new Promise<Answer>((resolve) => {
    const timer = setTimeout(() => {
      l.answer = null;
      resolve({ kind: 'timeout' });
    }, BROWSER_RUN_LIMITS.waitMs);
    l.answer = (a) => {
      clearTimeout(timer);
      resolve(a);
    };
  });
}

async function drive(row: Row, l: Live, continuing: boolean, resume: Resume | null): Promise<void> {
  const session = await openBrowserSession(l.key, {}, resume?.browser ?? null);
  if (!claim(session)) {
    throw new Error('the browser is busy with another run');
  }
  const { browserIsolation } = await import('./browserHost');
  const isolation = await browserIsolation();
  const step = async (s: Omit<BrowserStep, 'n' | 'at'>) => {
    l.steps.push({ ...s, n: l.steps.length + 1, at: new Date().toISOString() });
    await patch(row.id, { steps: l.steps });
    notify(l);
    await checkpoint(l);
  };
  if (resume) {
    await step({ kind: 'note', label: `Picked up again after the app restarted${resume.browser ? `, back on ${hostOf(resume.browser.url)}` : ''}`, ok: true });
  }

  // A run that was waiting on the person when its process went away waits again, as it was.
  let approved: string | null = null;
  if (resume?.waiting) {
    await patch(row.id, { status: 'waiting', ...(isolation ? { isolation } : {}) });
    notify(l);
    tellRoutine(row, { kind: 'waiting', waiting: resume.waiting });
    const a = await awaitPerson(l);
    tellRoutine(row, { kind: 'running' });
    if (a.kind === 'stopped') {
      await finish(row, l, { status: 'stopped', summary: 'Stopped by the person.' });
      return;
    }
    if (a.kind === 'timeout') {
      await finish(row, l, { status: 'failed', summary: 'Nobody answered in time, so it did not go ahead.', result: null, error: 'no answer' });
      return;
    }
    if (a.kind === 'approved' && resume.waiting.kind === 'approval') {
      approved = resume.waiting.step ?? resume.waiting.text;
      await step({ kind: 'approval', label: 'Approved by the person', ok: true });
    } else {
      l.notes.push(a.kind === 'answer' ? `The person answered "${resume.waiting.text}": ${a.text}` : `The person declined: ${resume.waiting.text}${a.kind === 'denied' && a.note ? ` (${a.note})` : ''}. Do not do it.`);
      await step({ kind: a.kind === 'answer' ? 'ask' : 'approval', label: a.kind === 'answer' ? `Answered: ${a.text.slice(0, 120)}` : 'Declined by the person', ok: a.kind === 'answer' });
    }
  }

  await patch(row.id, { status: 'running', waiting: null, ...(row.startedAt ? {} : { startedAt: new Date() }), ...(isolation ? { isolation } : {}) });
  notify(l);
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
  const { tokenUsageOf, modelIdOf } = await import('@/libs/llm/usage');
  const { tokenCostMicroCents } = await import('@/libs/pricing');
  const { resolvedModelId } = await import('@/libs/llm');
  const { runBrowserLoop } = await import('./browserLoop');
  // Thinking off: one quick action per step.
  const model = await buildChatModelForOrg('main', row.orgId, { temperature: 0, streaming: false, maxTokens: 2_000, thinking: 'off' });
  let micro = Number(row.microCents ?? 0);
  const plainInputs = Object.fromEntries(Object.entries(row.inputs ?? {}).filter(([, v]) => !v.secret).map(([k, v]) => [k, v.value]));
  // A run of a routine reads its approved version's rules and trust from the routine, every time it
  // starts or is picked up, so a restart never runs it under rules it was not started with.
  const routine = row.routineRunId ? await (await import('@/services/routines/RoutineService')).guideForRun(row.orgId, row.routineRunId) : null;

  const out = await runBrowserLoop(model, session, {
    task: row.task,
    startUrl: row.startUrl,
    inputs: plainInputs,
    secrets: l.secrets,
    outputs: row.outputs ?? [],
    continuing,
    ...(resume ? { resume: { done: l.steps.map(s => s.label), notes: l.notes, approved } } : {}),
    ...(routine ? { routine } : {}),
  }, {
    now: () => Date.now(),
    stopped: () => l.stop,
    step,
    notes: (n) => {
      l.notes = [...n];
      void checkpoint(l);
    },
    charge: async (response) => {
      // Filed in the spend ledger under the run a person can open: the routine run for a routine's row, else this browser run.
      const { withCallContext } = await import('@/services/spend/callContext');
      await withCallContext({
        userId: row.userId,
        ...(row.conversationId ? { conversationId: row.conversationId } : {}),
        ...(row.routineRunId ? { runKind: 'routine_run' as const, runId: row.routineRunId } : { runKind: 'browser_run' as const, runId: row.id }),
      }, () => chargeModelCall({ orgId: row.orgId, agentSlug: row.agentSlug ?? undefined, feature: 'browser.run', role: 'main', response }));
      const usage = tokenUsageOf(response);
      if (usage) {
        micro += tokenCostMicroCents(modelIdOf(response) ?? resolvedModelId('main'), usage);
        await patch(row.id, { microCents: micro });
      }
    },
    wait: async (w) => {
      const shotUrl = await keepShot(row.orgId, l.key);
      const waiting: BrowserWaiting = { ...w, ...(shotUrl ? { shotUrl } : {}), at: new Date().toISOString() };
      const answer = awaitPerson(l);
      await patch(row.id, { status: 'waiting', waiting });
      // The wait may outlast this process: what the run needs to wait again is sealed first.
      await checkpoint(l, true);
      notify(l);
      tellRoutine(row, { kind: 'waiting', waiting });
      if (!heldByCall(row.id) && !row.routineRunId) {
        await announce(row, 'waiting', `${browserRunLabel(row.id)} is waiting on you: ${w.kind === 'approval' ? `approve or decline “${w.text}”` : w.text}. Answer it in the run's pane.`).catch(() => {});
      }
      const a = await answer;
      await patch(row.id, { status: 'running', waiting: null });
      notify(l);
      tellRoutine(row, { kind: 'running' });
      return a;
    },
  });
  await finish(row, l, out);
}

type Ending = { status: 'done'; summary: string; result: Record<string, unknown> } | { status: 'failed'; summary: string; result: Record<string, unknown> | null; error: string } | { status: 'stopped'; summary: string };

async function finish(row: Row, l: Live, out: Ending): Promise<void> {
  const shot = await keepShot(row.orgId, l.key);
  const status: BrowserRunStatus = out.status;
  await patch(row.id, {
    status,
    summary: out.summary,
    result: 'result' in out ? out.result : null,
    error: out.status === 'failed' ? out.error : null,
    waiting: null,
    finalShotUrl: shot,
    endedAt: new Date(),
    steps: l.steps,
    // Its secrets and the browser's cookies are not kept once the run has ended.
    checkpoint: null,
    runnerId: null,
  });
  notify(l);
  if (out.status === 'stopped') {
    await closeBrowserSession(l.key);
  }
  tellRoutine(row, { kind: 'ended', status, summary: out.summary, result: 'result' in out ? out.result : null, error: out.status === 'failed' ? out.error : null, wroteAfterApproval: wroteAfterApproval(l.steps) });
  if (!heldByCall(row.id) && !row.routineRunId) {
    await announce(row, status, resultMessage(row, out.summary, 'result' in out ? out.result : null, status)).catch(() => {});
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the page it was on';
  }
}

/**
 * Pick up a run whose process went away: claim it in one write (so two processes cannot both),
 * open its checkpoint and carry on. One that has been picked up too often stops and says so.
 * @param id - The run.
 */
async function adopt(id: number): Promise<void> {
  if (live.has(id)) {
    return;
  }
  const cutoff = new Date(Date.now() - STALE_MS);
  const [row] = await db.update(browserRunSchema)
    .set({ runnerId: RUNNER_ID, heartbeatAt: new Date(), resumes: sql`${browserRunSchema.resumes} + 1`, updatedAt: new Date() })
    .where(and(eq(browserRunSchema.id, id), inArray(browserRunSchema.status, ['queued', 'running', 'waiting']), or(isNull(browserRunSchema.heartbeatAt), lt(browserRunSchema.heartbeatAt, cutoff))))
    .returning()
    .catch(() => []);
  if (!row || live.has(id)) {
    return;
  }
  if (row.resumes > MAX_RESUMES) {
    const error = `The app restarted ${row.resumes - 1} times while this run was going; it stopped rather than start over again. Ask for it again to run it.`;
    await patch(id, { status: 'failed', error, summary: error, waiting: null, endedAt: new Date(), checkpoint: null, runnerId: null });
    tellRoutine(row, { kind: 'ended', status: 'failed', summary: error, result: null, error, wroteAfterApproval: wroteAfterApproval(row.steps ?? []) });
    await announce(row, 'failed', `${browserRunLabel(id)} stopped: ${error}`).catch(() => {});
    return;
  }
  const saved = await unseal(row);
  const owed = Object.entries(row.inputs ?? {}).filter(([, v]) => v.secret).map(([k]) => k).filter(k => !(saved?.secrets && k in saved.secrets));
  if (owed.length > 0) {
    const error = 'The app restarted while this run was going, and its secret inputs could not be read back. Ask for it again to run it.';
    await patch(id, { status: 'failed', error, summary: error, waiting: null, endedAt: new Date(), checkpoint: null, runnerId: null });
    tellRoutine(row, { kind: 'ended', status: 'failed', summary: error, result: null, error, wroteAfterApproval: wroteAfterApproval(row.steps ?? []) });
    return;
  }
  console.warn('[browser] picking up a run after a restart', { run: id, status: row.status, resumes: row.resumes });
  begin(row, saved?.secrets ?? {}, false, { browser: saved?.browser ?? null, notes: saved?.notes ?? [], waiting: row.status === 'waiting' ? row.waiting ?? null : null });
}

let keeper: ReturnType<typeof setInterval> | null = null;

/**
 * Pick up, every few seconds, any run whose process went away — started at boot
 * (`instrumentation.ts`), so a deploy in the middle of a run is a pause, not an ending.
 */
export function startBrowserRunKeeper(): void {
  if (keeper) {
    return;
  }
  const sweep = async () => {
    const cutoff = new Date(Date.now() - STALE_MS);
    const rows = await db.select({ id: browserRunSchema.id }).from(browserRunSchema).where(and(inArray(browserRunSchema.status, ['queued', 'running', 'waiting']), or(isNull(browserRunSchema.heartbeatAt), lt(browserRunSchema.heartbeatAt, cutoff)))).limit(20).catch(() => [] as Array<{ id: number }>);
    for (const r of rows) {
      await adopt(r.id).catch(e => console.warn('[browser] could not pick a run up', { run: r.id, reason: (e as Error).message }));
    }
  };
  keeper = setInterval(() => void sweep(), 10_000);
  keeper.unref?.();
  setTimeout(() => void sweep(), 3_000).unref?.();
}

/**
 * The result in the conversation's words: the summary, then each output — a list of rows as a table.
 * @param row - The run.
 * @param summary - What it did.
 * @param result - Its outputs.
 * @param status - How it ended.
 */
export function resultMessage(row: Pick<Row, 'id'>, summary: string, result: Record<string, unknown> | null, status: string): string {
  const head = status === 'done' ? `${browserRunLabel(row.id)} is done. ${summary}` : status === 'stopped' ? `${browserRunLabel(row.id)} was stopped.` : `${browserRunLabel(row.id)} could not finish: ${summary}`;
  const parts = [head];
  for (const [k, v] of Object.entries(result ?? {})) {
    parts.push(`**${k.replace(/_/g, ' ')}**\n\n${renderValue(v)}`);
  }
  return parts.join('\n\n');
}

function cell(v: unknown): string {
  const text = v === null || v === undefined ? '' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const words = (k: string) => k.replace(/_/g, ' ');

function renderValue(v: unknown): string {
  if (Array.isArray(v) && v.length > 0 && v.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
    const cols = [...new Set(v.flatMap(x => Object.keys(x as object)))];
    return [`| ${cols.map(words).join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...v.map(x => `| ${cols.map(c => cell((x as Record<string, unknown>)[c])).join(' | ')} |`)].join('\n');
  }
  if (Array.isArray(v)) {
    return v.map(x => `- ${cell(x)}`).join('\n');
  }
  if (v && typeof v === 'object') {
    return Object.entries(v).map(([k, x]) => `- ${k}: ${cell(x)}`).join('\n');
  }
  return v === null || v === undefined ? '(not found)' : cell(v);
}

/**
 * Say where the run stands in the conversation it was asked from, when there is one — in the app,
 * and in the Slack thread or text thread the conversation lives on (`tellConversation`), once per
 * run and state, with the page as it ended.
 * @param row - The run.
 * @param status - What is being said: done, failed, stopped or waiting.
 * @param content - The words.
 */
async function announce(row: Row, status: string, content: string): Promise<void> {
  if (!row.conversationId || row.routineRunId) {
    return;
  }
  const { tellConversation } = await import('@/services/chat/tellConversation');
  const [fresh] = await db.select({ shot: browserRunSchema.finalShotUrl, steps: browserRunSchema.steps }).from(browserRunSchema).where(eq(browserRunSchema.id, row.id)).limit(1);
  const n = status === 'waiting' ? (fresh?.steps?.length ?? 0) : 0;
  const files = status !== 'waiting' && fresh?.shot ? [{ url: fresh.shot, caption: `${browserRunLabel(row.id)}: the page as it ended` }] : [];
  await tellConversation(row.orgId, row.conversationId, `${content}\n\n[${browserRunLabel(row.id)}](/dashboard/browser/${row.id})`, { key: `browser:${row.id}:${status}:${n}`, files, url: `/dashboard/browser/${row.id}` });
}
