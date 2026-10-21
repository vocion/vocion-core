/**
 * BROWSER RUNS: a task handed to a browser, as a run — the row
 * (`browser_run`), the person's browser it runs in (`browserEngine.ts`) and
 * the loop that drives it (`browserLoop.ts`).
 *
 * Who starts one. A person who asks for it in their own words: the run starts
 * at once, as theirs. An agent that thinks a task needs a browser: the run is
 * `proposed`, and starts when the person presses Start on it (the pane, the
 * chip). The same rule as every other action (`turnJudge.saidToDecide`).
 *
 * One live run per person at a time (`BrowserRunBusyError`), in one browser
 * that stays open between their runs, so the next task can carry on from the
 * page the last one left.
 *
 * Where the result goes: on the run, always; to the tool call that started
 * it when that call is still waiting; otherwise into the conversation it was
 * asked from, as one message — done, failed, or waiting on the person.
 *
 * In this process: the browser and the loop live where the run started, and
 * nothing of them survives a restart. A run that was live when the process
 * went away reads as failed, saying so, the next time anything reads it.
 */

import type { BrowserInput, BrowserOutputSpec, BrowserRunStatus, BrowserRunView, BrowserStep, BrowserWaiting } from '@/libs/browser/run';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { asRootRun } from '@/libs/agents/rootRun';
import { BROWSER_RUN_LIMITS, browserRunLabel, isLive, SECRET_MASK } from '@/libs/browser/run';
import { db } from '@/libs/DB';
import { browserRunSchema } from '@/models/Schema';
import { claim, closeBrowserSession, existingSession, frameSeq, latestFrame, openBrowserSession, personKey, releaseBrowserSession, screenshot, whereNow } from './browserEngine';

type Row = typeof browserRunSchema.$inferSelect;

/** The person's browser is already running a task. */
export class BrowserRunBusyError extends Error {
  constructor(public readonly runId: number, task: string) {
    super(`your browser is busy with ${browserRunLabel(runId)} (“${task.slice(0, 80)}”). Stop it or wait for it to finish.`);
  }
}

/** A request about a run this person may not act on, or that is not in that state. */
export class BrowserRunError extends Error {}

type Answer = { kind: 'approved' } | { kind: 'denied'; note?: string } | { kind: 'answer'; text: string } | { kind: 'stopped' } | { kind: 'timeout' };

type Live = {
  id: number;
  orgId: string;
  userId: string;
  key: string;
  stop: boolean;
  /** The person's pending answer to a wait. */
  answer: ((a: Answer) => void) | null;
  secrets: Record<string, string>;
  steps: BrowserStep[];
  /** A tool call is waiting on this run: it hands the result over, so the run does not also post it. */
  heldByCall: number;
  /** Who is waiting for the next change of state. */
  listeners: Set<() => void>;
};

const live = new Map<number, Live>();
/** Secrets of runs proposed but not started, kept in this process only. */
const pendingSecrets = new Map<number, Record<string, string>>();

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

function toView(row: Row, l?: Live | null): BrowserRunView {
  const key = personKey(row.orgId, row.userId);
  const where = l ? whereNow(key) : null;
  const steps = l?.steps ?? row.steps ?? [];
  const lastUrl = [...steps].reverse().find(s => s.url)?.url ?? row.startUrl ?? null;
  return {
    id: row.id,
    status: row.status,
    task: row.task,
    startUrl: row.startUrl,
    inputs: row.inputs ?? {},
    outputs: row.outputs ?? [],
    result: row.result ?? null,
    summary: row.summary,
    steps,
    waiting: row.waiting ?? null,
    error: row.error,
    url: where?.url && where.url !== 'about:blank' ? where.url : lastUrl,
    title: where?.title ?? null,
    frameSeq: l ? frameSeq(key) : 0,
    live: Boolean(l && latestFrame(key)),
    finalShotUrl: row.finalShotUrl,
    proposedBy: row.proposedBy,
    agentSlug: row.agentSlug,
    conversationId: row.conversationId,
    cents: Math.round(Number(row.microCents ?? 0) / 1_000_000),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function patch(id: number, values: Partial<typeof browserRunSchema.$inferInsert>): Promise<void> {
  await db.update(browserRunSchema).set({ ...values, updatedAt: new Date() }).where(eq(browserRunSchema.id, id));
}

async function readRow(orgId: string, id: number): Promise<Row | null> {
  const [row] = await db.select().from(browserRunSchema).where(and(eq(browserRunSchema.orgId, orgId), eq(browserRunSchema.id, id))).limit(1);
  if (!row) {
    return null;
  }
  // Live in the database and not in this process: the process that ran it went away.
  if (isLive(row.status) && !live.has(row.id)) {
    const error = 'The app restarted while this run was going, so the browser closed. Ask for it again to run it.';
    await patch(row.id, { status: 'failed', error, waiting: null, endedAt: new Date() });
    return { ...row, status: 'failed', error, waiting: null, endedAt: new Date() };
  }
  return row;
}

/**
 * A run as the pane draws it, or null when this workspace has no such run.
 * @param orgId - The workspace.
 * @param id - The run.
 */
export async function getBrowserRun(orgId: string, id: number): Promise<BrowserRunView | null> {
  const row = await readRow(orgId, id);
  return row ? toView(row, live.get(id)) : null;
}

/**
 * The person's live run, when they have one.
 * @param orgId - The workspace.
 * @param userId - The person.
 */
export async function liveRunFor(orgId: string, userId: string): Promise<{ id: number; task: string } | null> {
  const rows = await db.select({ id: browserRunSchema.id, task: browserRunSchema.task, status: browserRunSchema.status }).from(browserRunSchema).where(and(eq(browserRunSchema.orgId, orgId), eq(browserRunSchema.userId, userId), inArray(browserRunSchema.status, ['queued', 'running', 'waiting']))).orderBy(desc(browserRunSchema.id)).limit(5);
  for (const r of rows) {
    if (live.has(r.id)) {
      return { id: r.id, task: r.task };
    }
    await readRow(orgId, r.id);
  }
  return null;
}

/**
 * The person's recent runs, newest first.
 * @param orgId - The workspace.
 * @param userId - The person.
 * @param limit - How many.
 */
export async function recentBrowserRuns(orgId: string, userId: string, limit = 20): Promise<BrowserRunView[]> {
  const rows = await db.select().from(browserRunSchema).where(and(eq(browserRunSchema.orgId, orgId), eq(browserRunSchema.userId, userId))).orderBy(desc(browserRunSchema.id)).limit(limit);
  return rows.map(r => toView(r, live.get(r.id)));
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
  /** Which inputs are secrets: kept in this process for the run, stored as `••••`. */
  secretNames?: string[];
  outputs?: BrowserOutputSpec[];
  /** `person` when they asked for it; `agent:<slug>` when suggested. */
  proposedBy: string;
  /** Start now (the person asked) or wait for their Start (suggested). */
  start: boolean;
  /** Carry on from the page the person's browser is on, instead of opening `startUrl`. */
  continuing?: boolean;
};

/**
 * File a run, and start it when the person asked for it.
 * @param input - The run.
 */
export async function createBrowserRun(input: CreateBrowserRun): Promise<BrowserRunView> {
  if (input.start) {
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
  }).returning();
  if (input.start) {
    begin(row!, secrets, input.continuing ?? false);
    return toView(row!, live.get(row!.id));
  }
  pendingSecrets.set(row!.id, secrets);
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
  const secrets = pendingSecrets.get(id) ?? {};
  const owed = Object.entries(row.inputs ?? {}).filter(([, v]) => v.secret).map(([k]) => k).filter(k => !(k in secrets));
  if (owed.length > 0) {
    throw new BrowserRunError(`The secret input${owed.length > 1 ? 's' : ''} ${owed.join(', ')} ${owed.length > 1 ? 'were' : 'was'} not kept after the app restarted. Ask for the run again.`);
  }
  pendingSecrets.delete(id);
  await patch(id, { status: 'queued' });
  const fresh = { ...row, status: 'queued' as const };
  begin(fresh, secrets, false);
  return toView(fresh, live.get(id));
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
  if (row.status === 'proposed') {
    pendingSecrets.delete(id);
    await patch(id, { status: 'stopped', endedAt: new Date(), summary: 'Not started.' });
    return;
  }
  const l = live.get(id);
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
  const l = live.get(id);
  if (row.status !== 'waiting' || !l?.answer) {
    throw new BrowserRunError(`${browserRunLabel(id)} is not waiting on you.`);
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
 * Mark that a tool call has handed this run's latest state to the conversation, so the run does not post it again.
 * @param id
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

function begin(row: Row, secrets: Record<string, string>, continuing: boolean): void {
  const key = personKey(row.orgId, row.userId);
  const l: Live = { id: row.id, orgId: row.orgId, userId: row.userId, key, stop: false, answer: null, secrets, steps: [...(row.steps ?? [])], heldByCall: 0, listeners: new Set() };
  live.set(row.id, l);
  // Its own root run: the chat turn that started it has its own callbacks and abort signal, and
  // neither may reach this loop (its text would stream into the chat; its end would abort the run).
  void asRootRun(() => drive(row, l, continuing)).catch(async (e) => {
    const error = e instanceof Error ? e.message.split('\n')[0]!.slice(0, 400) : String(e);
    await patch(row.id, { status: 'failed', error, waiting: null, endedAt: new Date(), steps: l.steps }).catch(() => {});
    await announce(row, 'failed', `${browserRunLabel(row.id)} stopped: ${error}`).catch(() => {});
  }).finally(() => {
    live.delete(row.id);
    notify(l);
    releaseBrowserSession(key);
  });
}

async function drive(row: Row, l: Live, continuing: boolean): Promise<void> {
  const session = await openBrowserSession(l.key);
  if (!claim(session)) {
    throw new Error('the browser is busy with another run');
  }
  await patch(row.id, { status: 'running', startedAt: new Date() });
  notify(l);
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
  const { tokenUsageOf, modelIdOf } = await import('@/libs/llm/usage');
  const { tokenCostMicroCents } = await import('@/libs/pricing');
  const { resolvedModelId } = await import('@/libs/llm');
  const { runBrowserLoop } = await import('./browserLoop');
  // Thinking off: one quick action per step, and a forced tool call cannot be combined with it.
  const model = await buildChatModelForOrg('main', row.orgId, { temperature: 0, streaming: false, maxTokens: 2_000, thinking: 'off' });
  let micro = 0;
  const plainInputs = Object.fromEntries(Object.entries(row.inputs ?? {}).filter(([, v]) => !v.secret).map(([k, v]) => [k, v.value]));

  const out = await runBrowserLoop(model, session, {
    task: row.task,
    startUrl: row.startUrl,
    inputs: plainInputs,
    secrets: l.secrets,
    outputs: row.outputs ?? [],
    continuing,
  }, {
    now: () => Date.now(),
    stopped: () => l.stop,
    step: async (s) => {
      l.steps.push({ ...s, n: l.steps.length + 1, at: new Date().toISOString() });
      await patch(row.id, { steps: l.steps });
      notify(l);
    },
    charge: async (response) => {
      await chargeModelCall({ orgId: row.orgId, agentSlug: row.agentSlug ?? undefined, feature: 'browser.run', role: 'main', response });
      const usage = tokenUsageOf(response);
      if (usage) {
        micro += tokenCostMicroCents(modelIdOf(response) ?? resolvedModelId('main'), usage);
        await patch(row.id, { microCents: micro });
      }
    },
    wait: async (w) => {
      const shotUrl = await keepShot(row.orgId, l.key);
      const waiting: BrowserWaiting = { ...w, ...(shotUrl ? { shotUrl } : {}), at: new Date().toISOString() };
      const answer = new Promise<Answer>((resolve) => {
        const timer = setTimeout(() => {
          l.answer = null;
          resolve({ kind: 'timeout' });
        }, BROWSER_RUN_LIMITS.waitMs);
        l.answer = (a) => {
          clearTimeout(timer);
          resolve(a);
        };
      });
      await patch(row.id, { status: 'waiting', waiting });
      notify(l);
      if (!heldByCall(row.id)) {
        await announce(row, 'waiting', `${browserRunLabel(row.id)} is waiting on you: ${w.kind === 'approval' ? `approve or decline “${w.text}”` : w.text}. Answer it in the run's pane.`).catch(() => {});
      }
      const a = await answer;
      await patch(row.id, { status: 'running', waiting: null });
      notify(l);
      return a;
    },
  });

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
  });
  notify(l);
  if (out.status === 'stopped') {
    await closeBrowserSession(l.key);
  }
  if (!heldByCall(row.id)) {
    await announce(row, status, resultMessage(row, out.summary, 'result' in out ? out.result : null, status)).catch(() => {});
  }
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
  if (!row.conversationId) {
    return;
  }
  const { tellConversation } = await import('@/services/chat/tellConversation');
  const [fresh] = await db.select({ shot: browserRunSchema.finalShotUrl, steps: browserRunSchema.steps }).from(browserRunSchema).where(eq(browserRunSchema.id, row.id)).limit(1);
  const n = status === 'waiting' ? (fresh?.steps?.length ?? 0) : 0;
  const files = status !== 'waiting' && fresh?.shot ? [{ url: fresh.shot, caption: `${browserRunLabel(row.id)}: the page as it ended` }] : [];
  await tellConversation(row.orgId, row.conversationId, `${content}\n\n[${browserRunLabel(row.id)}](/dashboard/browser/${row.id})`, { key: `browser:${row.id}:${status}:${n}`, files, url: `/dashboard/browser/${row.id}` });
}
