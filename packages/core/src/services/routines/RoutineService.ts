/**
 * ROUTINES: repeatable work a specialist taught once, run by Vocion in a
 * browser, escalated to its expert when a rule says so, and improved from
 * every correction (`libs/routines/types.ts`).
 *
 *   teach       a Slate recording → the Routine analyst's draft (`teaching.ts`),
 *               from a link, or launched from Vocion and picked up when the
 *               recording is finished (`startRoutineKeeper`).
 *   approve     the expert approves a version; runs are pinned to it. Answering
 *               an open question on an approved version is a new draft version,
 *               never an edit of the live one.
 *   trust       Drafted → Approved → Autonomous, per routine, enforced by the
 *               engine (`browserLoop` `hold`): at Approved, the writes the spec
 *               names run unattended and anything else still waits.
 *   run         a batch: one browser run per row (`BrowserRunService`, each in a
 *               browser of its own), at most `ROUTINE_LIMITS.concurrency` at once
 *               per workspace, the rest queued. The dedupe ledger (`idem_key`)
 *               skips a row this routine already did.
 *   escalate    a run that waits — an `escalate` call, or a held step — is one
 *               Decision on Needs you for the expert, docked in the conversation
 *               the batch was asked from. Their answer goes back to the run.
 *   receipt     a run that ends is checked against its own read-back: each output
 *               the spec says must equal an input. A run that stopped after a
 *               write it cannot confirm is an unknown outcome — never replayed,
 *               the expert checks.
 *   reconcile   after the rows, one read-only run lists the system's records;
 *               those not in the rows are a finding, with a decision for the
 *               expert (deactivate them, delete them, leave them). A change they
 *               choose is a follow-up batch under the same routine, its writes
 *               approved by their answer.
 *   report      a batch's results, time and cost, as an artifact.
 */

import type { BrowserRunStatus, BrowserWaiting } from '@/libs/browser/run';
import type { ReceiptCheck, RoutineBatchView, RoutineFinding, RoutineOutputSpec, RoutineReceipt, RoutineRunStatus, RoutineSpec, RoutineTrust, RoutineView, RoutineWrite } from '@/libs/routines/types';
import type { Ask } from '@/services/AskService';
import type { RoutineGuide } from '@/services/browser/browserLoop';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { asRootRun } from '@/libs/agents/rootRun';
import { db } from '@/libs/DB';
import { batchLabel, clock, ROUTINE_LIMITS, routineRunOpen, TRUST_LABEL } from '@/libs/routines/types';
import { routineBatchSchema, routineRunSchema, routineSchema, routineVersionSchema } from '@/models/Schema';
import { batchStatusLine, batchView, currentVersions, getBatch, getRoutine, namesOf } from './routineReads';
import { compileTask, runOutputs, settleAnswers, workflowYamlFor } from './teaching';

type RoutineRow = typeof routineSchema.$inferSelect;
type VersionRow = typeof routineVersionSchema.$inferSelect;
type BatchRow = typeof routineBatchSchema.$inferSelect;
type RunRow = typeof routineRunSchema.$inferSelect;

/** A request about a routine this person may not make, or that is not in that state. */
export class RoutineError extends Error {}

/** Verified runs of one version before it may be Autonomous. */
const AUTONOMOUS_AFTER = 20;

function concurrency(): number {
  const n = Number(process.env.VOCION_ROUTINE_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? Math.floor(n) : ROUTINE_LIMITS.concurrency;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

async function routineRow(orgId: string, id: number): Promise<RoutineRow> {
  const [r] = await db.select().from(routineSchema).where(and(eq(routineSchema.orgId, orgId), eq(routineSchema.id, id))).limit(1);
  if (!r) {
    throw new RoutineError('No such routine in this workspace.');
  }
  return r;
}

async function versionsOf(routineId: number): Promise<VersionRow[]> {
  return db.select().from(routineVersionSchema).where(eq(routineVersionSchema.routineId, routineId)).orderBy(desc(routineVersionSchema.n));
}

async function touch(id: number, values: Partial<typeof routineSchema.$inferInsert> = {}): Promise<void> {
  await db.update(routineSchema).set({ ...values, updatedAt: new Date() }).where(eq(routineSchema.id, id));
}

function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'routine';
}

async function uniqueSlug(orgId: string, name: string): Promise<string> {
  const base = slugOf(name);
  const taken = new Set((await db.select({ slug: routineSchema.slug }).from(routineSchema).where(eq(routineSchema.orgId, orgId))).map(r => r.slug));
  if (!taken.has(base)) {
    return base;
  }
  for (let i = 2; i < 500; i += 1) {
    if (!taken.has(`${base}-${i}`)) {
      return `${base}-${i}`;
    }
  }
  return `${base}-${Date.now()}`;
}

/**
 * Tell every screen showing this routine or batch that it moved. Never throws.
 * @param orgId - The workspace.
 * @param ids - What moved.
 * @param ids.routineId - The routine.
 * @param ids.batchId - The batch.
 */
function pushLive(orgId: string, ids: { routineId?: number | null; batchId?: number | null }): void {
  const topics = [ids.routineId ? `routine:${ids.routineId}` : null, ids.batchId ? `routine-batch:${ids.batchId}` : null].filter((t): t is string => Boolean(t));
  if (topics.length === 0) {
    return;
  }
  void import('@/libs/live/publish').then(m => m.publish({ orgId, topics, ref: topics.at(-1)!, kind: 'changed' })).catch(() => {});
}

async function seal(orgId: string, values: Record<string, string>) {
  const { buildCredentialVault } = await import('@/libs/crypto/credentialVault');
  return buildCredentialVault().encrypt(orgId, Buffer.from(JSON.stringify(values), 'utf8'));
}

async function unseal(orgId: string, sealed: BatchRow['secrets']): Promise<Record<string, string>> {
  if (!sealed) {
    return {};
  }
  try {
    const { buildCredentialVault } = await import('@/libs/crypto/credentialVault');
    return JSON.parse((await buildCredentialVault().decrypt(orgId, sealed.ciphertext, sealed.nonce, sealed.authTag, sealed.dekId)).toString('utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * A row's keys as the spec names them: "First name" → first_name.
 * @param k
 */
function keyOf(k: string): string {
  return k.trim().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/\W+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function normalizeRow(row: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [keyOf(k), String(v ?? '').trim()]).filter(([k]) => k));
}

/**
 * What a row is about, for its tile: the person's name and email, or its first values.
 * @param row
 * @param spec
 */
function labelOf(row: Record<string, string>, spec: RoutineSpec): string {
  const name = row.name || [row.first_name, row.last_name].filter(Boolean).join(' ');
  const id = row.email || row.account || row.id;
  if (name || id) {
    return [name, id && id !== name ? id : null].filter(Boolean).join(' · ');
  }
  const own = spec.inputs.filter(i => !i.secret && !i.shared).map(i => row[i.name]).filter(Boolean);
  return own.slice(0, 2).join(' · ') || 'Row';
}

/**
 * The dedupe ledger's key: the routine's key inputs, joined; else every non-shared input.
 * @param row
 * @param spec
 */
export function idemKeyOf(row: Record<string, string>, spec: RoutineSpec): string | null {
  const keys = spec.inputs.filter(i => i.key && !i.secret);
  const use = keys.length > 0 ? keys : spec.inputs.filter(i => !i.secret && !i.shared);
  const parts = use.map(i => `${i.name}=${(row[i.name] ?? '').trim().toLowerCase()}`).filter(p => !p.endsWith('='));
  return parts.length > 0 ? parts.join('|') : null;
}

/* ------------------------------------------------------------------ */
/* Teaching                                                            */
/* ------------------------------------------------------------------ */

/**
 * Start teaching a routine: file it, and either read the recording it was given or wait for the
 * person to record one (launched from Vocion: the site in a new tab, the recorder beside it).
 * @param input - The request.
 * @param input.orgId - The workspace.
 * @param input.userId - The person teaching; the routine's expert until they name another.
 * @param input.name - What they call it.
 * @param input.targetUrl - The site they teach on.
 * @param input.note - Anything they add.
 * @param input.slateUrl - A recording already made.
 * @param input.conversationId - Where they asked, when in chat.
 */
export async function startTeaching(input: { orgId: string; userId: string; name: string; targetUrl: string | null; note: string | null; slateUrl: string | null; conversationId: number | null }): Promise<{ routine: RoutineView; recordUrl: string | null }> {
  const slug = await uniqueSlug(input.orgId, input.name);
  // No page can start Slate's recorder (`libs/slate/watch.ts`): the person presses its hotkey on
  // the tab the page opens, and Slate's web recorder is there for anyone without the extension.
  let recordUrl: string | null = null;
  let instruction: string | null = null;
  if (!input.slateUrl) {
    const { slateRecordUrl } = await import('@/libs/slate/watch');
    const plan = slateRecordUrl({ title: input.name, targetUrl: input.targetUrl ?? undefined });
    recordUrl = plan.webRecorderUrl;
    instruction = plan.instruction;
  }
  const now = new Date().toISOString();
  const [row] = await db.insert(routineSchema).values({
    orgId: input.orgId,
    slug,
    name: input.name.trim(),
    status: 'teaching',
    trust: 'drafted',
    expertUserId: input.userId,
    createdBy: input.userId,
    conversationId: input.conversationId,
    source: input.slateUrl ? { kind: 'slate', url: input.slateUrl } : null,
    teaching: { state: input.slateUrl ? 'reading' : 'waiting_for_recording', startedAt: now, targetUrl: input.targetUrl, recordUrl, instruction, checks: 0, lastCheckedAt: null, note: input.note, userId: input.userId },
  }).returning();
  if (input.slateUrl) {
    teachInBackground(row!.id);
  }
  return { routine: (await getRoutine(input.orgId, row!.id))!, recordUrl };
}

/**
 * Hand a waiting routine its recording: a Slate link pasted, or the one the keeper found.
 * @param orgId - The workspace.
 * @param userId - The person.
 * @param id - The routine.
 * @param url - The Slate link.
 */
export async function attachRecording(orgId: string, userId: string, id: number, url: string): Promise<void> {
  const r = await routineRow(orgId, id);
  if (!/^https?:\/\//i.test(url.trim())) {
    throw new RoutineError('That is not a link to a recording.');
  }
  if (r.teaching?.state === 'reading' || r.teaching?.state === 'drafting') {
    throw new RoutineError('Vocion is already reading a recording for this routine.');
  }
  const startedAt = r.teaching?.startedAt ?? new Date().toISOString();
  await touch(id, { source: { kind: 'slate', url: url.trim() }, error: null, status: 'teaching', teaching: { state: 'reading', startedAt, targetUrl: r.teaching?.targetUrl ?? null, recordUrl: r.teaching?.recordUrl ?? null, instruction: r.teaching?.instruction ?? null, checks: r.teaching?.checks ?? 0, lastCheckedAt: r.teaching?.lastCheckedAt ?? null, note: r.teaching?.note ?? null, userId: r.teaching?.userId ?? userId } });
  pushLive(orgId, { routineId: id });
  teachInBackground(id);
}

const teaching: Map<number, Promise<void>> = ((globalThis as { __vocionRoutineTeaching?: Map<number, Promise<void>> }).__vocionRoutineTeaching ??= new Map());

function teachInBackground(id: number): void {
  if (teaching.has(id)) {
    return;
  }
  const p = asRootRun(() => teach(id)).catch(e => console.warn('[routines] teaching failed', { routine: id, reason: (e as Error).message })).finally(() => teaching.delete(id));
  teaching.set(id, p);
}

/**
 * Wait for a routine being taught to be drafted (or fail), up to a while.
 * @param orgId - The workspace.
 * @param id - The routine.
 * @param ms - The longest to wait.
 */
export async function waitForDraft(orgId: string, id: number, ms: number): Promise<RoutineView | null> {
  const p = teaching.get(id);
  if (p) {
    await Promise.race([p, new Promise(r => setTimeout(r, ms))]);
  }
  return getRoutine(orgId, id);
}

async function teach(id: number): Promise<void> {
  const [r] = await db.select().from(routineSchema).where(eq(routineSchema.id, id)).limit(1);
  if (!r?.source?.url) {
    return;
  }
  const fail = async (message: string) => {
    await touch(id, { error: message, teaching: r.teaching ? { ...r.teaching, state: 'failed' } : null });
    pushLive(r.orgId, { routineId: id });
  };
  const { readSlateRecording, slateCredentialsForOrg, slateFrames } = await import('@/libs/slate/recording');
  const creds = await slateCredentialsForOrg(r.orgId, r.teaching?.userId ?? r.createdBy);
  if (!creds.ok) {
    await fail(creds.message);
    return;
  }
  const rec = await readSlateRecording(creds.credentials, r.source.url);
  if (!rec.ok) {
    await fail(rec.message);
    return;
  }
  await touch(id, {
    source: { kind: 'slate', url: rec.data.video.url || r.source.url, videoId: rec.data.video.id, title: rec.data.video.title, durationSec: rec.data.video.durationSec, recordedBy: rec.data.video.recordedBy },
    teaching: r.teaching ? { ...r.teaching, state: 'drafting' } : null,
  });
  pushLive(r.orgId, { routineId: id });
  const { draftSpec, framesToRead } = await import('./teaching');
  const frames = await slateFrames(creds.credentials, r.source.url, framesToRead(rec.data));
  let drafted;
  try {
    drafted = await draftSpec(r.orgId, rec.data, frames.ok ? frames.data : [], { name: r.name, note: r.teaching?.note ?? null, startUrl: r.teaching?.targetUrl ?? null });
  } catch (e) {
    await fail(`Vocion could not draft a routine from the recording: ${(e as Error).message}`);
    return;
  }
  const versions = await versionsOf(id);
  const n = (versions[0]?.n ?? 0) + 1;
  await db.insert(routineVersionSchema).values({
    orgId: r.orgId,
    routineId: id,
    n,
    status: 'draft',
    spec: drafted.spec,
    task: compileTask(r.name, drafted.spec),
    workflowYaml: workflowYamlFor(r.slug, r.name, n, drafted.spec),
    change: n === 1 ? null : 'Taught again from a new recording',
  });
  await touch(id, { status: 'in_review', description: drafted.description || null, teaching: null, error: null });
  pushLive(r.orgId, { routineId: id });
  if (r.conversationId) {
    const { tellConversation } = await import('@/services/chat/tellConversation');
    const open = drafted.spec.questions.length;
    await tellConversation(r.orgId, r.conversationId, `Routine “${r.name}” is drafted from the recording: ${drafted.spec.steps.length} steps, ${drafted.spec.rules.length} rules, ${drafted.spec.escalations.length} escalation points${open ? `, and ${open} question${open > 1 ? 's' : ''} for its expert` : ''}. [Open the routine](/dashboard/routines/${id})`, { key: `routine:${id}:drafted:${n}`, url: `/dashboard/routines/${id}` }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* The expert's hand                                                   */
/* ------------------------------------------------------------------ */

async function asExpert(r: RoutineRow, userId: string): Promise<void> {
  if (r.expertUserId && r.expertUserId !== userId) {
    const names = await namesOf([r.expertUserId]);
    throw new RoutineError(`Only the routine's expert (${names.get(r.expertUserId) ?? 'its expert'}) can do that.`);
  }
  if (!r.expertUserId) {
    await touch(r.id, { expertUserId: userId });
  }
}

/**
 * Approve the routine's draft: runs use it from now on, and the version before is superseded.
 * @param orgId - The workspace.
 * @param userId - The expert.
 * @param id - The routine.
 */
export async function approveRoutineVersion(orgId: string, userId: string, id: number): Promise<void> {
  const r = await routineRow(orgId, id);
  await asExpert(r, userId);
  const versions = await versionsOf(id);
  const draft = versions.find(v => v.status === 'draft');
  if (!draft) {
    throw new RoutineError('There is no draft to approve.');
  }
  const open = draft.spec.questions.filter(q => !q.answer);
  if (open.length > 0) {
    throw new RoutineError(`Answer the open question${open.length > 1 ? 's' : ''} first: ${open.map(q => `“${q.question}”`).join(' ')}`);
  }
  await db.update(routineVersionSchema).set({ status: 'superseded' }).where(and(eq(routineVersionSchema.routineId, id), eq(routineVersionSchema.status, 'approved')));
  await db.update(routineVersionSchema).set({ status: 'approved', approvedBy: userId, approvedAt: new Date() }).where(eq(routineVersionSchema.id, draft.id));
  await touch(id, { status: 'live' });
  pushLive(orgId, { routineId: id });
}

/**
 * Move the routine on the trust ladder. Approved needs an approved version; Autonomous is earned on
 * verified runs of that version.
 * @param orgId - The workspace.
 * @param userId - The expert.
 * @param id - The routine.
 * @param trust - The level.
 */
export async function setRoutineTrust(orgId: string, userId: string, id: number, trust: RoutineTrust): Promise<void> {
  const r = await routineRow(orgId, id);
  await asExpert(r, userId);
  const { current } = currentVersions(await versionsOf(id));
  if (trust !== 'drafted' && current?.status !== 'approved') {
    throw new RoutineError('Approve a version first: trust is given to an approved version.');
  }
  if (trust === 'autonomous') {
    const verified = (await db.select({ receipt: routineRunSchema.receipt }).from(routineRunSchema).where(and(eq(routineRunSchema.routineId, id), eq(routineRunSchema.version, current!.n), eq(routineRunSchema.status, 'done')))).filter(x => x.receipt?.verified).length;
    if (verified < AUTONOMOUS_AFTER) {
      throw new RoutineError(`Autonomous is earned: ${AUTONOMOUS_AFTER} verified runs of version ${current!.n} first (it has ${verified}).`);
    }
  }
  await touch(id, { trust });
  pushLive(orgId, { routineId: id });
}

/**
 * The expert answers one of the analyst's open questions. On a draft, the answer is written into
 * it; on an approved version, the answer is a new draft version (the live one is never edited).
 * @param orgId - The workspace.
 * @param userId - The expert.
 * @param id - The routine.
 * @param questionId - The question.
 * @param answer - Their answer.
 */
export async function answerRoutineQuestion(orgId: string, userId: string, id: number, questionId: string, answer: string): Promise<void> {
  const r = await routineRow(orgId, id);
  await asExpert(r, userId);
  const versions = await versionsOf(id);
  const { current, draft } = currentVersions(versions);
  const target = draft ?? current;
  if (!target) {
    throw new RoutineError('This routine has no version yet.');
  }
  const q = target.spec.questions.find(x => x.id === questionId);
  if (!q) {
    throw new RoutineError('No such question on this routine.');
  }
  const spec: RoutineSpec = settleAnswers({ ...target.spec, questions: target.spec.questions.map(x => (x.id === questionId ? { ...x, answer: answer.trim(), answeredBy: userId } : x)) });
  if (target.status === 'draft') {
    await db.update(routineVersionSchema).set({ spec, task: compileTask(r.name, spec), workflowYaml: workflowYamlFor(r.slug, r.name, target.n, spec) }).where(eq(routineVersionSchema.id, target.id));
  } else {
    const n = (versions[0]?.n ?? 0) + 1;
    await db.insert(routineVersionSchema).values({ orgId, routineId: id, n, status: 'draft', spec, task: compileTask(r.name, spec), workflowYaml: workflowYamlFor(r.slug, r.name, n, spec), change: `The expert answered: ${q.question}` });
    await touch(id, { status: r.status === 'live' ? 'live' : 'in_review' });
  }
  await touch(id);
  pushLive(orgId, { routineId: id });
}

/**
 * Name the routine's expert: the person its escalations go to.
 * @param orgId - The workspace.
 * @param userId - The current expert (or anyone, when it has none).
 * @param id - The routine.
 * @param expertUserId - The new expert.
 */
export async function setRoutineExpert(orgId: string, userId: string, id: number, expertUserId: string): Promise<void> {
  const r = await routineRow(orgId, id);
  await asExpert(r, userId);
  await touch(id, { expertUserId });
  pushLive(orgId, { routineId: id });
}

/**
 * Retire a routine: kept, with its runs, and never run again.
 * @param orgId - The workspace.
 * @param userId - The expert.
 * @param id - The routine.
 */
export async function retireRoutine(orgId: string, userId: string, id: number): Promise<void> {
  const r = await routineRow(orgId, id);
  await asExpert(r, userId);
  await touch(id, { status: 'retired', teaching: null });
  pushLive(orgId, { routineId: id });
}

/**
 * A correction written as a new draft version: what the expert said, made a rule of the routine.
 * @param orgId - The workspace.
 * @param userId - The expert.
 * @param id - The routine.
 * @param rule - The rule, in their words.
 */
export async function addRoutineRule(orgId: string, userId: string, id: number, rule: string): Promise<void> {
  const r = await routineRow(orgId, id);
  await asExpert(r, userId);
  const versions = await versionsOf(id);
  const { current, draft } = currentVersions(versions);
  const base = draft ?? current;
  if (!base) {
    throw new RoutineError('This routine has no version yet.');
  }
  const spec: RoutineSpec = { ...base.spec, rules: [...base.spec.rules, { text: rule.trim(), at: null }] };
  if (base.status === 'draft') {
    await db.update(routineVersionSchema).set({ spec, task: compileTask(r.name, spec), workflowYaml: workflowYamlFor(r.slug, r.name, base.n, spec), change: base.change ?? `The expert added a rule: ${rule.trim()}` }).where(eq(routineVersionSchema.id, base.id));
  } else {
    const n = (versions[0]?.n ?? 0) + 1;
    await db.insert(routineVersionSchema).values({ orgId, routineId: id, n, status: 'draft', spec, task: compileTask(r.name, spec), workflowYaml: workflowYamlFor(r.slug, r.name, n, spec), change: `The expert added a rule: ${rule.trim()}` });
  }
  await touch(id);
  pushLive(orgId, { routineId: id });
}

/* ------------------------------------------------------------------ */
/* Batches                                                             */
/* ------------------------------------------------------------------ */

export type StartBatch = {
  orgId: string;
  userId: string;
  routineId: number;
  rows: Array<Record<string, string>>;
  /** Inputs every row shares (the campaign, the sign-in), a secret's value included. */
  shared?: Record<string, string>;
  conversationId: number | null;
};

/**
 * Run a routine for many rows: one run per row, under its approved version. Rows this routine
 * already did (the dedupe ledger) are skipped; the rest run, at most a few at once.
 * @param input - The request.
 */
export async function startRoutineBatch(input: StartBatch): Promise<RoutineBatchView> {
  const r = await routineRow(input.orgId, input.routineId);
  if (r.status === 'retired') {
    throw new RoutineError('This routine is retired.');
  }
  const { current } = currentVersions(await versionsOf(r.id));
  if (!current || current.status !== 'approved') {
    throw new RoutineError('Approve a version of this routine first: a routine runs only under an approved version.');
  }
  if (!current.spec.startUrl) {
    throw new RoutineError('This routine does not say where the work starts. Answer “What is the address the work starts at?” and approve the new version.');
  }
  if (input.rows.length === 0 || input.rows.length > ROUTINE_LIMITS.batchRows) {
    throw new RoutineError(`A batch takes 1 to ${ROUTINE_LIMITS.batchRows} rows.`);
  }
  const spec = current.spec;
  const shared = normalizeRow(input.shared ?? {});
  const rows = input.rows.map(normalizeRow);
  // Shared inputs given on every row (a sign-in pasted with the list) move to the batch.
  for (const i of spec.inputs.filter(x => x.shared || x.secret)) {
    if (!shared[i.name]) {
      const v = rows.find(row => row[i.name])?.[i.name];
      if (v) {
        shared[i.name] = v;
      }
    }
  }
  const secretNames = new Set(spec.inputs.filter(i => i.secret).map(i => i.name));
  const missingShared = spec.inputs.filter(i => (i.shared || i.secret) && !i.optional && !shared[i.name]).map(i => i.name);
  if (missingShared.length > 0) {
    throw new RoutineError(`Missing for the whole batch: ${missingShared.join(', ')}.`);
  }
  const perRow = spec.inputs.filter(i => !i.shared && !i.secret && !i.optional);
  const incomplete = rows.map((row, i) => ({ i, missing: perRow.filter(x => !row[x.name]).map(x => x.name) })).filter(x => x.missing.length > 0);
  if (incomplete.length > 0) {
    const first = incomplete[0]!;
    throw new RoutineError(`${incomplete.length} row${incomplete.length > 1 ? 's are' : ' is'} missing inputs (row ${first.i + 1}: ${first.missing.join(', ')}). Each row needs ${perRow.map(x => x.name).join(', ')}.`);
  }
  const plainShared = Object.fromEntries(Object.entries(shared).filter(([k]) => !secretNames.has(k)));
  const secretShared = Object.fromEntries(Object.entries(shared).filter(([k]) => secretNames.has(k)));
  const [batch] = await db.insert(routineBatchSchema).values({
    orgId: input.orgId,
    routineId: r.id,
    version: current.n,
    requestedBy: input.userId,
    conversationId: input.conversationId,
    shared: plainShared,
    secrets: Object.keys(secretShared).length > 0 ? await seal(input.orgId, secretShared) : null,
  }).returning();
  // The dedupe ledger: work this routine already did, and work in this batch twice.
  const keys = rows.map(row => idemKeyOf(row, spec));
  const done = keys.some(Boolean)
    ? await db.select({ id: routineRunSchema.id, idemKey: routineRunSchema.idemKey, batchId: routineRunSchema.batchId, status: routineRunSchema.status }).from(routineRunSchema).where(and(eq(routineRunSchema.routineId, r.id), inArray(routineRunSchema.idemKey, keys.filter((k): k is string => Boolean(k))), inArray(routineRunSchema.status, ['done', 'unknown_outcome'])))
    : [];
  const seen = new Set<string>();
  const values = rows.map((row, i) => {
    const key = keys[i] ?? null;
    const prior = key ? done.find(d => d.idemKey === key) : undefined;
    const twice = key ? seen.has(key) : false;
    if (key) {
      seen.add(key);
    }
    const input = Object.fromEntries(Object.entries(row).filter(([k]) => !secretNames.has(k)));
    const skip = prior
      ? (prior.status === 'done' ? `Already done by this routine (batch ${prior.batchId}): not done twice.` : `An earlier run (batch ${prior.batchId}) stopped after a change it could not confirm; it waits on the expert to check, so it is not run again.`)
      : twice ? 'The same row appears earlier in this batch: done once.' : null;
    return {
      orgId: input.orgId,
      routineId: r.id,
      batchId: batch!.id,
      version: current.n,
      n: i + 1,
      label: labelOf({ ...plainShared, ...row }, spec),
      status: (skip ? 'skipped' : 'queued') as RoutineRunStatus,
      input,
      idemKey: key,
      summary: skip,
      endedAt: skip ? new Date() : null,
    };
  });
  await db.insert(routineRunSchema).values(values.map(v => ({ ...v, orgId: input.orgId })));
  pushLive(input.orgId, { routineId: r.id, batchId: batch!.id });
  await dispatch(input.orgId);
  await finishIfDone(batch!.id);
  return (await getBatch(input.orgId, batch!.id))!;
}

const dispatching: Map<string, Promise<void>> = ((globalThis as { __vocionRoutineDispatch?: Map<string, Promise<void>> }).__vocionRoutineDispatch ??= new Map());

/**
 * Start queued runs while the workspace has room: at most `concurrency()` driven at once.
 * One dispatcher per workspace at a time in this process.
 * @param orgId - The workspace.
 */
export async function dispatch(orgId: string): Promise<void> {
  const prior = dispatching.get(orgId) ?? Promise.resolve();
  const next = prior.then(() => dispatchNow(orgId)).catch(e => console.warn('[routines] dispatch failed', { orgId, reason: (e as Error).message }));
  dispatching.set(orgId, next);
  await next;
  if (dispatching.get(orgId) === next) {
    dispatching.delete(orgId);
  }
}

async function dispatchNow(orgId: string): Promise<void> {
  // Only runs at work take a slot: one waiting on its expert holds a page, not the workspace's room.
  const busy = await db.select({ id: routineRunSchema.id }).from(routineRunSchema).where(and(eq(routineRunSchema.orgId, orgId), eq(routineRunSchema.status, 'running')));
  const room = concurrency() - busy.length;
  if (room <= 0) {
    return;
  }
  const queued = await db.select().from(routineRunSchema).where(and(eq(routineRunSchema.orgId, orgId), eq(routineRunSchema.status, 'queued'))).orderBy(asc(routineRunSchema.batchId), asc(routineRunSchema.n)).limit(room);
  for (const run of queued) {
    await startRun(run).catch(async (e) => {
      const error = (e as Error).message.slice(0, 400);
      await db.update(routineRunSchema).set({ status: 'failed', error, summary: `Could not start: ${error}`, endedAt: new Date(), updatedAt: new Date() }).where(eq(routineRunSchema.id, run.id));
      pushLive(orgId, { routineId: run.routineId, batchId: run.batchId });
      await finishIfDone(run.batchId);
    });
  }
}

async function startRun(run: RunRow): Promise<void> {
  // Claimed in one write: a second dispatcher finds it no longer queued.
  const [claimed] = await db.update(routineRunSchema).set({ status: 'running', startedAt: new Date(), updatedAt: new Date() }).where(and(eq(routineRunSchema.id, run.id), eq(routineRunSchema.status, 'queued'))).returning();
  if (!claimed) {
    return;
  }
  const [batch] = await db.select().from(routineBatchSchema).where(eq(routineBatchSchema.id, run.batchId)).limit(1);
  const [r] = await db.select().from(routineSchema).where(eq(routineSchema.id, run.routineId)).limit(1);
  const [version] = await db.select().from(routineVersionSchema).where(and(eq(routineVersionSchema.routineId, run.routineId), eq(routineVersionSchema.n, run.version))).limit(1);
  if (!batch || !r || !version) {
    throw new Error('its routine, version or batch is gone');
  }
  const secrets = { ...(await unseal(run.orgId, batch.secrets)), ...(await unseal(run.orgId, run.secrets)) };
  const plain = { ...batch.shared, ...run.input };
  const task = run.task ?? batch.followUp?.task ?? version.task;
  const outputs = run.outputs ?? batch.followUp?.outputs ?? runOutputs(version.spec.outputs);
  const { createBrowserRun } = await import('@/services/browser/BrowserRunService');
  const view = await createBrowserRun({
    orgId: run.orgId,
    userId: batch.requestedBy,
    conversationId: null,
    agentSlug: null,
    task,
    startUrl: run.n === 0 ? (version.spec.reconcile?.listUrl ?? version.spec.startUrl) : version.spec.startUrl,
    inputs: { ...plain, ...secrets },
    secretNames: Object.keys(secrets),
    outputs,
    proposedBy: `routine:${r.slug}`,
    start: true,
    routineRunId: run.id,
  });
  await db.update(routineRunSchema).set({ browserRunId: view.id, updatedAt: new Date() }).where(eq(routineRunSchema.id, run.id));
  pushLive(run.orgId, { routineId: run.routineId, batchId: run.batchId });
}

/**
 * What a run of a routine is told beyond its task: the approved version's rules, escalation points,
 * prohibited actions, postconditions, the writes it may take, and whether it takes them unattended.
 * Read fresh each time a run starts or is picked up.
 * @param orgId - The workspace.
 * @param routineRunId - The run.
 */
export async function guideForRun(orgId: string, routineRunId: number): Promise<RoutineGuide | null> {
  const [run] = await db.select().from(routineRunSchema).where(and(eq(routineRunSchema.orgId, orgId), eq(routineRunSchema.id, routineRunId))).limit(1);
  if (!run) {
    return null;
  }
  const [batch] = await db.select().from(routineBatchSchema).where(eq(routineBatchSchema.id, run.batchId)).limit(1);
  const [r] = await db.select().from(routineSchema).where(eq(routineSchema.id, run.routineId)).limit(1);
  const [version] = await db.select().from(routineVersionSchema).where(and(eq(routineVersionSchema.routineId, run.routineId), eq(routineVersionSchema.n, run.version))).limit(1);
  if (!r || !version) {
    return null;
  }
  const spec = version.spec;
  const names = await namesOf([r.expertUserId]);
  // The reconciliation only reads; a follow-up takes the writes its finding's answer approved.
  const reading = run.n === 0;
  const followUp = batch?.followUp ?? null;
  const writes: RoutineWrite[] = reading ? [] : followUp ? followUp.writes : spec.writes;
  return {
    name: r.name,
    expert: r.expertUserId ? names.get(r.expertUserId) ?? null : null,
    rules: [...spec.rules.map(x => x.text), ...spec.questions.filter(q => q.answer).map(q => `${q.question} → ${q.answer}`)],
    escalations: reading ? [] : spec.escalations.map(e => ({ when: e.when, ask: e.ask })),
    prohibited: reading ? ['Change anything: this run only reads the list.', ...spec.prohibited] : followUp ? spec.prohibited.filter(p => !/deactivat|delet/i.test(p)) : spec.prohibited,
    postconditions: reading ? [] : followUp ? [] : spec.postconditions,
    writes,
    autoWrites: !reading && (Boolean(followUp) || r.trust !== 'drafted'),
  };
}

/* ------------------------------------------------------------------ */
/* What a run says                                                     */
/* ------------------------------------------------------------------ */

type RunEvent = { kind: 'waiting'; waiting: BrowserWaiting } | { kind: 'running' } | { kind: 'ended'; status: BrowserRunStatus; summary: string; result: Record<string, unknown> | null; error: string | null; wroteAfterApproval: boolean };

/**
 * A run of a routine moved: it waits on someone, it carries on, it ended (`BrowserRunService`).
 * @param orgId - The workspace.
 * @param routineRunId - The routine's run.
 * @param browserRunId - Its browser run.
 * @param event - What happened.
 */
export async function onBrowserRunEvent(orgId: string, routineRunId: number, browserRunId: number, event: RunEvent): Promise<void> {
  const [run] = await db.select().from(routineRunSchema).where(and(eq(routineRunSchema.orgId, orgId), eq(routineRunSchema.id, routineRunId))).limit(1);
  if (!run) {
    return;
  }
  if (event.kind === 'waiting') {
    await runWaits(run, event.waiting);
    await dispatch(orgId);
  } else if (event.kind === 'running') {
    await runCarriesOn(run);
  } else {
    await runEnded(run, event);
  }
  pushLive(orgId, { routineId: run.routineId, batchId: run.batchId });
  void browserRunId;
}

function firstSentence(t: string): string {
  const m = /^(.+?[.?!])(?:\s|$)/.exec(t.trim());
  return (m ? m[1]! : t).trim();
}

type RunAnswer = { kind: 'approve' } | { kind: 'deny'; note?: string } | { kind: 'answer'; text: string };

/**
 * Hand an answer to the waiting run. A run between processes (a restart, a reload) takes it a
 * moment later; one that is not picked up in time keeps it on its row and takes it when it waits
 * again (`runWaits`), never asking twice.
 * @param orgId - The workspace.
 * @param run - The routine run.
 * @param answer - The answer.
 */
async function deliver(orgId: string, run: RunRow, answer: RunAnswer): Promise<void> {
  const { answerRoutineBrowserRun } = await import('@/services/browser/BrowserRunService');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await answerRoutineBrowserRun(orgId, run.browserRunId!, answer);
      return;
    } catch (e) {
      if (!/picked up again|in a moment|not waiting/.test((e as Error).message)) {
        console.warn('[routines] an answer could not reach its run', { run: run.id, reason: (e as Error).message });
        return;
      }
      await new Promise(r => setTimeout(r, 3_000));
    }
  }
  const [fresh] = await db.select({ waiting: routineRunSchema.waiting }).from(routineRunSchema).where(eq(routineRunSchema.id, run.id)).limit(1);
  if (fresh?.waiting) {
    await db.update(routineRunSchema).set({ waiting: { ...fresh.waiting, answer }, updatedAt: new Date() }).where(eq(routineRunSchema.id, run.id));
  }
}

async function runWaits(run: RunRow, w: BrowserWaiting): Promise<void> {
  if (run.waiting?.answer && run.waiting.at === w.at) {
    // Answered while no process held the run: it takes the answer now.
    const answer = run.waiting.answer;
    setTimeout(() => void deliver(run.orgId, run, answer), 500);
    return;
  }
  const [batch] = await db.select().from(routineBatchSchema).where(eq(routineBatchSchema.id, run.batchId)).limit(1);
  const [r] = await db.select().from(routineSchema).where(eq(routineSchema.id, run.routineId)).limit(1);
  if (!batch || !r) {
    return;
  }
  const kind = w.escalation ? 'escalation' : w.kind;
  const options = w.kind === 'approval' ? ['Approve', 'Decline'] : (w.options ?? []);
  const { upsertAsk } = await import('@/services/AskService');
  const [text, ...evidence] = w.text.split('\n\n');
  // One card per question, docked where the batch was asked: who it is about, and the question.
  const who = run.label.split(' · ')[0]!;
  const title = w.kind === 'approval'
    ? `${who}: approve “${(w.step ?? w.text).replace(/^Click /, '').slice(0, 60)}”?`
    : `${who}: ${firstSentence(text!).slice(0, 90)}`;
  const { ask } = await upsertAsk({
    orgId: run.orgId,
    createdBy: `routine:${r.slug}`,
    ask: {
      kind: w.kind === 'approval' ? 'approval' : 'ruling',
      title,
      body: (w.kind === 'approval' ? `${r.name}, run ${run.n} holds before this click: at ${TRUST_LABEL[r.trust]} trust it is outside what the approved spec takes on its own.` : `${r.name}, run ${run.n}: ${text!}`).slice(0, 390),
      contextMd: [`${batchLabel(batch.id)} · run ${run.n} · ${run.label}`, evidence.length > 0 ? `> ${evidence.join('\n\n').slice(0, 800)}` : '', w.shotUrl ? `[The page as it stopped](${w.shotUrl})` : ''].filter(Boolean).join('\n\n'),
      sourceRef: `routine-run:${run.id}:${Date.parse(w.at) || Date.now()}`,
      options: options.map((label, i) => ({ id: w.kind === 'approval' ? (i === 0 ? 'approve' : 'decline') : `o${i + 1}`, label, ...(i === 0 ? { recommended: true } : {}) })),
      allowOther: w.kind !== 'approval',
      contextUrl: `/dashboard/routines/batches/${batch.id}`,
      conversationId: batch.conversationId,
      ownerUserId: r.expertUserId ?? batch.requestedBy,
      objectRefs: [],
    },
  });
  await db.update(routineRunSchema).set({
    status: kind === 'escalation' ? 'escalated' : 'waiting',
    waiting: { kind, text: w.text, options, askId: ask.id, at: w.at },
    askId: ask.id,
    updatedAt: new Date(),
  }).where(eq(routineRunSchema.id, run.id));
}

/** A decision takes a person a minute or two; the rest of a wait is time they were elsewhere. */
const DECISION_MS_CAP = 2 * 60_000;

function decisionMs(waiting: RunRow['waiting']): number {
  return waiting ? Math.min(DECISION_MS_CAP, Math.max(0, Date.now() - Date.parse(waiting.at))) : 0;
}

async function runCarriesOn(run: RunRow): Promise<void> {
  const waitedMs = decisionMs(run.waiting);
  if (run.askId) {
    // Answered in the run's pane rather than on Needs you: the Decision leaves the queue.
    const { getAsk, supersedeAsk } = await import('@/services/AskService');
    const ask = await getAsk(run.orgId, run.askId);
    if (ask?.status === 'open') {
      await supersedeAsk(run.orgId, run.askId, 'Answered in the run’s pane.').catch(() => {});
    }
  }
  await db.update(routineRunSchema).set({ status: 'running', waiting: null, humanMs: Number(run.humanMs ?? 0) + (run.waiting ? waitedMs : 0), updatedAt: new Date() }).where(eq(routineRunSchema.id, run.id));
}

function norm(v: unknown): string {
  if (v === null || v === undefined) {
    return '';
  }
  return (typeof v === 'object' ? JSON.stringify(v) : String(v)).trim().toLowerCase().replace(/\s+/g, ' ');
}

function asDate(s: string): string | null {
  if (!/\d/.test(s)) {
    return null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/**
 * One read-back check: the saved value against the input it was asked for. Equal, or one holds the
 * other ("Q4 Security Awareness (CMP-12)" holds "Q4 Security Awareness"), or the same date.
 * @param name - The output.
 * @param expected - The input's value.
 * @param actual - What the run read back.
 */
export function checkValue(name: string, expected: string, actual: unknown): ReceiptCheck {
  const e = norm(expected);
  const a = norm(actual);
  const ok = Boolean(e) && Boolean(a) && (e === a || a.includes(e) || e.includes(a) || (asDate(e) !== null && asDate(e) === asDate(a)));
  return { name, expected, actual: a ? String(actual) : null, ok };
}

/**
 * The receipt for a run that ended: what it was asked, what was there before, what it read back,
 * and whether each read-back matches.
 * @param input - Its inputs.
 * @param outputs - The outputs it owed.
 * @param result - What it gave.
 * @param approvedBy - Who let the write through.
 */
export function receiptFor(input: Record<string, string>, outputs: RoutineOutputSpec[], result: Record<string, unknown> | null, approvedBy: string): RoutineReceipt {
  const checks = outputs.filter(o => o.checks && input[o.checks!] !== undefined).map(o => checkValue(o.name, input[o.checks!]!, result?.[o.name]));
  const after = Object.fromEntries(Object.entries(result ?? {}).filter(([k]) => k !== 'before'));
  return {
    requested: input,
    before: typeof result?.before === 'string' ? result.before : result?.before ? JSON.stringify(result.before) : null,
    after,
    checks,
    verified: checks.length > 0 && checks.every(c => c.ok),
    approvedBy,
    at: new Date().toISOString(),
  };
}

async function runEnded(run: RunRow, e: Extract<RunEvent, { kind: 'ended' }>): Promise<void> {
  const [batch] = await db.select().from(routineBatchSchema).where(eq(routineBatchSchema.id, run.batchId)).limit(1);
  const [r] = await db.select().from(routineSchema).where(eq(routineSchema.id, run.routineId)).limit(1);
  const [version] = await db.select().from(routineVersionSchema).where(and(eq(routineVersionSchema.routineId, run.routineId), eq(routineVersionSchema.n, run.version))).limit(1);
  if (!batch || !r || !version) {
    return;
  }
  if (run.askId) {
    const { getAsk, supersedeAsk } = await import('@/services/AskService');
    const ask = await getAsk(run.orgId, run.askId);
    if (ask?.status === 'open') {
      await supersedeAsk(run.orgId, run.askId, 'The run ended.').catch(() => {});
    }
  }
  const waitedMs = decisionMs(run.waiting);
  const base = { waiting: null, askId: null, endedAt: new Date(), updatedAt: new Date(), humanMs: Number(run.humanMs ?? 0) + waitedMs, summary: e.summary.slice(0, 1_000) };
  if (run.n === 0) {
    // The reconciliation: what it read becomes the batch's finding.
    await db.update(routineRunSchema).set({ ...base, status: e.status === 'done' ? 'done' : e.status === 'stopped' ? 'stopped' : 'failed', error: e.error }).where(eq(routineRunSchema.id, run.id));
    if (e.status === 'done') {
      await findingFromReconcile(batch, r, version.spec, e.result);
    }
    await closeBatch(batch.id);
    return;
  }
  const input = { ...batch.shared, ...run.input };
  const outputs = run.outputs ?? batch.followUp?.outputs ?? runOutputs(version.spec.outputs);
  const approvedBy = batch.followUp ? `the expert's answer (${batch.followUp.approvedBy})` : r.trust === 'drafted' ? 'a person, at each held step' : `the approved spec (${TRUST_LABEL[r.trust]} trust)`;
  let status: RoutineRunStatus;
  let receipt: RoutineReceipt | null = null;
  let error = e.error;
  if (e.status === 'done') {
    receipt = receiptFor(input, outputs, e.result, approvedBy);
    if (!receipt.verified && base.humanMs > 0 && receipt.checks.some(c => c.ok)) {
      // The expert answered an escalation on this run ("the same person: enroll the existing user"):
      // a read-back that differs from the row the way their answer said is theirs, not a failure.
      receipt = { ...receipt, checks: receipt.checks.map(c => (c.ok ? c : { ...c, waived: 'as the expert answered' })), verified: true };
    }
    if (!e.wroteAfterApproval) {
      // Nothing was saved: the expert said to leave it, or there was nothing to do.
      status = 'skipped';
    } else if (receipt.verified || receipt.checks.length === 0) {
      status = 'done';
      receipt.verified = receipt.checks.length > 0 ? receipt.verified : true;
    } else {
      status = 'failed';
      error = `The read-back did not match: ${receipt.checks.filter(c => !c.ok).map(c => `${c.name} reads “${c.actual ?? 'nothing'}”, expected “${c.expected}”`).join('; ')}.`;
    }
  } else if (e.status === 'stopped') {
    status = 'stopped';
  } else {
    status = e.wroteAfterApproval ? 'unknown_outcome' : 'failed';
  }
  await db.update(routineRunSchema).set({ ...base, status, receipt, error }).where(eq(routineRunSchema.id, run.id));
  if (status === 'unknown_outcome') {
    const { upsertAsk } = await import('@/services/AskService');
    await upsertAsk({
      orgId: run.orgId,
      createdBy: `routine:${r.slug}`,
      ask: {
        kind: 'ruling',
        title: `${r.name} · ${run.label}: check by hand — it stopped after a change it could not confirm`,
        body: `Run ${run.n} of ${batchLabel(batch.id)} took a write and then stopped (${(e.error ?? e.summary).slice(0, 300)}). It is not run again on its own, so nothing is done twice. Check the record, then say what you found.`,
        sourceRef: `routine-check:${run.id}`,
        options: [{ id: 'right', label: 'Checked: it is right', recommended: true }, { id: 'fixed', label: 'I fixed it by hand' }, { id: 'again', label: 'Run it again' }],
        contextUrl: `/dashboard/routines/batches/${batch.id}`,
        conversationId: batch.conversationId,
        ownerUserId: r.expertUserId ?? batch.requestedBy,
        objectRefs: [],
      },
    }).catch(() => {});
  }
  await dispatch(run.orgId);
  await finishIfDone(batch.id);
}

/**
 * When every row of a batch is closed: reconcile, once, where the routine says how; then close it.
 * @param batchId - The batch.
 */
async function finishIfDone(batchId: number): Promise<void> {
  const [batch] = await db.select().from(routineBatchSchema).where(eq(routineBatchSchema.id, batchId)).limit(1);
  if (!batch || batch.status === 'done') {
    return;
  }
  const runs = await db.select({ n: routineRunSchema.n, status: routineRunSchema.status }).from(routineRunSchema).where(eq(routineRunSchema.batchId, batchId));
  if (runs.some(x => routineRunOpen(x.status))) {
    return;
  }
  const [version] = await db.select().from(routineVersionSchema).where(and(eq(routineVersionSchema.routineId, batch.routineId), eq(routineVersionSchema.n, batch.version))).limit(1);
  const reconcile = version?.spec.reconcile ?? null;
  if (reconcile && !batch.followUp && !runs.some(x => x.n === 0) && runs.some(x => x.status === 'done' || x.status === 'skipped')) {
    const matchOn = reconcile.matchOn;
    await db.insert(routineRunSchema).values({
      orgId: batch.orgId,
      routineId: batch.routineId,
      batchId,
      version: batch.version,
      n: 0,
      label: 'Check the account against the list',
      status: 'queued',
      input: {},
      task: [
        `Read, without changing anything, the full list of records this routine adds${reconcile.listUrl ? `, starting at ${reconcile.listUrl}` : ''}. ${reconcile.how}`,
        'Sign in with the account given if asked. Read every page of the list. Do not open records one by one unless the list hides a column you need.',
        `Give records: every record in the list, one row each, with name, ${matchOn}, and status as the list shows them.`,
      ].join(' '),
      outputs: [{ name: 'records', description: `Every record in the list: name, ${matchOn}, status`, checks: null }],
    });
    pushLive(batch.orgId, { routineId: batch.routineId, batchId });
    await dispatch(batch.orgId);
    return;
  }
  await closeBatch(batchId);
}

async function closeBatch(batchId: number): Promise<void> {
  const [closed] = await db.update(routineBatchSchema).set({ status: 'done', endedAt: new Date() }).where(and(eq(routineBatchSchema.id, batchId), ne(routineBatchSchema.status, 'done'))).returning();
  if (!closed) {
    return;
  }
  pushLive(closed.orgId, { routineId: closed.routineId, batchId });
  if (closed.conversationId) {
    const view = await batchView(closed);
    const { tellConversation } = await import('@/services/chat/tellConversation');
    const findings = view.findings.filter(f => f.state === 'open');
    await tellConversation(closed.orgId, closed.conversationId, [
      `${batchLabel(batchId)} (${view.routine.name}) is done: ${batchStatusLine(view)}.`,
      findings.length > 0 ? `It found something: ${findings.map(f => f.title).join('; ')}. The question is on Needs you.` : '',
      `[Open ${batchLabel(batchId)}](/dashboard/routines/batches/${batchId})`,
    ].filter(Boolean).join('\n\n'), { key: `routine-batch:${batchId}:done`, url: `/dashboard/routines/batches/${batchId}` }).catch(() => {});
  }
}

/**
 * The records in the system that are not in the batch's rows, as a finding with a decision.
 * @param batch - The batch.
 * @param r - Its routine.
 * @param spec - Its version's spec.
 * @param result - What the reconciliation read.
 */
async function findingFromReconcile(batch: BatchRow, r: RoutineRow, spec: RoutineSpec, result: Record<string, unknown> | null): Promise<void> {
  const matchOn = spec.reconcile?.matchOn ?? 'email';
  const records = Array.isArray(result?.records) ? (result!.records as Array<Record<string, unknown>>).filter(x => x && typeof x === 'object') : [];
  const rows = await db.select({ input: routineRunSchema.input }).from(routineRunSchema).where(and(eq(routineRunSchema.batchId, batch.id), ne(routineRunSchema.n, 0)));
  const listed = new Set(rows.map(x => norm(x.input[matchOn])).filter(Boolean));
  // A record on the list under another identifier (the same person, a second email) is not an
  // extra: names count too.
  const listedNames = new Set(rows.map(x => norm(x.input.name || [x.input.first_name, x.input.last_name].filter(Boolean).join(' '))).filter(Boolean));
  const value = (rec: Record<string, unknown>) => norm(rec[matchOn] ?? Object.entries(rec).find(([k]) => keyOf(k) === matchOn)?.[1]);
  const nameOf = (rec: Record<string, unknown>) => norm(rec.name ?? [rec.first_name, rec.last_name].filter(Boolean).join(' '));
  const active = (rec: Record<string, unknown>) => !/deactivat|inactive|disabled|removed|deleted/i.test(String(rec.status ?? ''));
  const extras = records.filter(rec => value(rec) && !listed.has(value(rec)) && !listedNames.has(nameOf(rec)) && active(rec)).map(rec => Object.fromEntries(Object.entries(rec).map(([k, v]) => [keyOf(k), v === null || v === undefined ? '' : String(v)])));
  const findings: RoutineFinding[] = [...(batch.findings ?? [])];
  if (extras.length === 0) {
    findings.push({ id: 'f1', kind: 'note', title: 'Every record in the account is on the list', detail: `Read ${records.length} records; none is missing from the ${listed.size} rows this batch was given.`, items: [], askId: null, options: [], state: 'info', answer: null, followUpBatchId: null });
  } else {
    const noun = extras.length === 1 ? 'record' : 'records';
    const options = ['Deactivate them', 'Delete them', 'Leave them as they are'];
    const title = `${extras.length} ${noun} in the account ${extras.length === 1 ? 'is' : 'are'} not on the list`;
    const detail = `Checked the account against the ${listed.size} rows this batch was given: ${extras.length} active ${noun} ${extras.length === 1 ? 'is' : 'are'} not on it.`;
    const { upsertAsk } = await import('@/services/AskService');
    const { ask } = await upsertAsk({
      orgId: batch.orgId,
      createdBy: `routine:${r.slug}`,
      ask: {
        kind: 'ruling',
        title: `${batchLabel(batch.id)}: ${title}. Deactivate or delete them?`,
        body: `${detail}\n\n${extras.map(x => `- ${x.name ?? ''} ${x[matchOn] ? `<${x[matchOn]}>` : ''}${x.status ? ` · ${x.status}` : ''}`).join('\n')}\n\nDeactivating keeps their history and can be undone. Whatever you choose runs as its own batch under this routine, and only that change is allowed.`,
        sourceRef: `routine-finding:${batch.id}:f1`,
        options: options.map((label, i) => ({ id: `o${i + 1}`, label, ...(i === 0 ? { recommended: true } : {}) })),
        allowOther: true,
        contextUrl: `/dashboard/routines/batches/${batch.id}`,
        conversationId: batch.conversationId,
        ownerUserId: r.expertUserId ?? batch.requestedBy,
        objectRefs: [],
      },
    });
    findings.push({ id: 'f1', kind: 'not_on_list', title, detail, items: extras, askId: ask.id, options, state: 'open', answer: null, followUpBatchId: null });
  }
  await db.update(routineBatchSchema).set({ findings }).where(eq(routineBatchSchema.id, batch.id));
}

/* ------------------------------------------------------------------ */
/* Answers                                                             */
/* ------------------------------------------------------------------ */

async function mayAnswer(orgId: string, userId: string, run: RunRow): Promise<void> {
  const [batch] = await db.select({ requestedBy: routineBatchSchema.requestedBy }).from(routineBatchSchema).where(eq(routineBatchSchema.id, run.batchId)).limit(1);
  const [r] = await db.select({ expertUserId: routineSchema.expertUserId }).from(routineSchema).where(eq(routineSchema.id, run.routineId)).limit(1);
  if (userId !== batch?.requestedBy && userId !== r?.expertUserId) {
    throw new RoutineError('Only the routine\'s expert or the person who ran the batch can answer its runs.');
  }
  void orgId;
}

/**
 * Answer a run waiting on its expert, from the queue: approve or decline its held step, answer its
 * escalation, or stop it. Recorded on its Decision, so Needs you and the run agree.
 * @param orgId - The workspace.
 * @param userId - The expert, or the person who ran the batch.
 * @param runId - The routine run.
 * @param decision - The answer.
 */
export async function answerRoutineRun(orgId: string, userId: string, runId: number, decision: { kind: 'approve' } | { kind: 'deny' } | { kind: 'stop' } | { kind: 'answer'; text: string }): Promise<RoutineBatchView> {
  const [run] = await db.select().from(routineRunSchema).where(and(eq(routineRunSchema.orgId, orgId), eq(routineRunSchema.id, runId))).limit(1);
  if (!run) {
    throw new RoutineError('No such run of a routine.');
  }
  await mayAnswer(orgId, userId, run);
  if (decision.kind === 'stop') {
    if (run.browserRunId) {
      const { stopRoutineBrowserRun } = await import('@/services/browser/BrowserRunService');
      await stopRoutineBrowserRun(orgId, run.browserRunId);
    } else if (run.status === 'queued') {
      await db.update(routineRunSchema).set({ status: 'stopped', summary: 'Stopped before it started.', endedAt: new Date(), updatedAt: new Date() }).where(eq(routineRunSchema.id, run.id));
      await finishIfDone(run.batchId);
    }
    return (await getBatch(orgId, run.batchId))!;
  }
  if (!run.waiting || !run.askId) {
    throw new RoutineError(`Run ${run.n} is not waiting on anyone.`);
  }
  const { decideAsk, getAsk } = await import('@/services/AskService');
  const ask = await getAsk(orgId, run.askId);
  if (!ask || ask.status !== 'open') {
    throw new RoutineError('That question was already answered.');
  }
  if (decision.kind === 'approve' || decision.kind === 'deny') {
    await decideAsk({ orgId, id: ask.id, decision: decision.kind === 'approve' ? 'approve' : 'decline', decidedBy: userId, via: 'needs_you' });
  } else {
    const option = ask.options.find(o => o.label.trim().toLowerCase() === decision.text.trim().toLowerCase());
    await decideAsk({ orgId, id: ask.id, decision: option ? option.id : 'other', note: option ? null : decision.text, decidedBy: userId, via: 'needs_you' });
  }
  return (await getBatch(orgId, run.batchId))!;
}

/**
 * A Decision a routine raised was settled — on Needs you, in the chat dock, or from the queue — and
 * its answer goes where it belongs: back to the waiting run, or to the batch's finding
 * (`AskService` → here, for `routine-…` source refs).
 * @param row - The settled ask.
 */
export async function onRoutineAskSettled(row: Ask): Promise<void> {
  const ref = row.sourceRef ?? '';
  if (row.status === 'superseded' || row.status === 'open') {
    return;
  }
  const chosen = row.options.find(o => o.id === row.decision);
  const words = chosen?.label ?? row.decisionNote ?? '';
  const by = row.decidedBy ?? 'the expert';
  let m = /^routine-run:(\d+):/.exec(ref);
  if (m) {
    const [run] = await db.select().from(routineRunSchema).where(and(eq(routineRunSchema.orgId, row.orgId), eq(routineRunSchema.id, Number(m[1])))).limit(1);
    if (!run?.browserRunId || run.askId !== row.id) {
      return;
    }
    const answer = row.decision === 'approve'
      ? { kind: 'approve' as const }
      : row.decision === 'decline'
        ? { kind: 'deny' as const, note: row.decisionNote ?? undefined }
        : { kind: 'answer' as const, text: row.status === 'skipped' || !words ? 'The expert did not answer. Do not save anything for this row; finish and say so.' : words };
    await db.update(routineRunSchema).set({ askId: null, updatedAt: new Date() }).where(eq(routineRunSchema.id, run.id));
    await deliver(row.orgId, run, answer);
    return;
  }
  m = /^routine-finding:(\d+):(\w+)$/.exec(ref);
  if (m) {
    await applyFindingAnswer(row.orgId, Number(m[1]), m[2]!, words || 'Leave them as they are', by);
    return;
  }
  m = /^routine-check:(\d+)$/.exec(ref);
  if (m) {
    const [run] = await db.select().from(routineRunSchema).where(and(eq(routineRunSchema.orgId, row.orgId), eq(routineRunSchema.id, Number(m[1])))).limit(1);
    if (!run || run.status !== 'unknown_outcome') {
      return;
    }
    if (row.decision === 'again') {
      await db.update(routineRunSchema).set({ status: 'queued', browserRunId: null, idemKey: null, receipt: null, error: null, summary: 'Run again: the expert checked and asked for it.', endedAt: null, updatedAt: new Date() }).where(eq(routineRunSchema.id, run.id));
      await db.update(routineBatchSchema).set({ status: 'running', endedAt: null }).where(eq(routineBatchSchema.id, run.batchId));
      await dispatch(row.orgId);
    } else {
      await db.update(routineRunSchema).set({ status: 'done', summary: `${run.summary ?? ''} The expert checked it by hand: ${words}.`.trim(), updatedAt: new Date() }).where(eq(routineRunSchema.id, run.id));
    }
    pushLive(row.orgId, { routineId: run.routineId, batchId: run.batchId });
  }
}

/**
 * Answer a batch's finding from its page: recorded on its Decision, which carries it out.
 * @param orgId - The workspace.
 * @param userId - The expert, or the person who ran the batch.
 * @param batchId - The batch.
 * @param findingId - The finding.
 * @param answer - The option's words, or their own.
 */
export async function answerFinding(orgId: string, userId: string, batchId: number, findingId: string, answer: string): Promise<RoutineBatchView> {
  const [batch] = await db.select().from(routineBatchSchema).where(and(eq(routineBatchSchema.orgId, orgId), eq(routineBatchSchema.id, batchId))).limit(1);
  const f = batch?.findings?.find(x => x.id === findingId);
  if (!batch || !f) {
    throw new RoutineError('No such finding.');
  }
  const [r] = await db.select({ expertUserId: routineSchema.expertUserId }).from(routineSchema).where(eq(routineSchema.id, batch.routineId)).limit(1);
  if (userId !== batch.requestedBy && userId !== r?.expertUserId) {
    throw new RoutineError('Only the routine\'s expert or the person who ran the batch can answer this.');
  }
  if (f.state !== 'open') {
    throw new RoutineError('That was already answered.');
  }
  const { decideAsk, getAsk } = await import('@/services/AskService');
  const ask = f.askId ? await getAsk(orgId, f.askId) : null;
  if (ask?.status === 'open') {
    const option = ask.options.find(o => o.label.trim().toLowerCase() === answer.trim().toLowerCase());
    await decideAsk({ orgId, id: ask.id, decision: option ? option.id : 'other', note: option ? null : answer, decidedBy: userId, via: 'needs_you' });
  } else {
    await applyFindingAnswer(orgId, batchId, findingId, answer, userId);
  }
  return (await getBatch(orgId, batchId))!;
}

async function applyFindingAnswer(orgId: string, batchId: number, findingId: string, answer: string, by: string): Promise<void> {
  const [batch] = await db.select().from(routineBatchSchema).where(and(eq(routineBatchSchema.orgId, orgId), eq(routineBatchSchema.id, batchId))).limit(1);
  const f = batch?.findings?.find(x => x.id === findingId);
  if (!batch || !f || f.state !== 'open') {
    return;
  }
  const verb = /deactivat/i.test(answer) ? 'deactivate' : /delet|remove/i.test(answer) ? 'delete' : null;
  let followUpBatchId: number | null = null;
  if (verb && f.items.length > 0) {
    const [r] = await db.select().from(routineSchema).where(eq(routineSchema.id, batch.routineId)).limit(1);
    const [version] = await db.select().from(routineVersionSchema).where(and(eq(routineVersionSchema.routineId, batch.routineId), eq(routineVersionSchema.n, batch.version))).limit(1);
    const names = await namesOf([by]);
    const matchOn = version?.spec.reconcile?.matchOn ?? 'email';
    const listUrl = version?.spec.reconcile?.listUrl ?? version?.spec.startUrl ?? null;
    const [follow] = await db.insert(routineBatchSchema).values({
      orgId,
      routineId: batch.routineId,
      version: batch.version,
      requestedBy: batch.requestedBy,
      conversationId: batch.conversationId,
      shared: batch.shared,
      secrets: batch.secrets,
      followUp: {
        parentBatchId: batch.id,
        findingId,
        task: `The routine's expert answered ${batchLabel(batch.id)}'s finding: “${answer}”. For the one record in the inputs (${matchOn} given), find it${listUrl ? ` from ${listUrl}` : ''}, open it, and ${verb} it — that change, and nothing else. Confirm it if the site asks. Then read the record back and give its status as the page shows it.`,
        writes: [{ button: verb, match: 'contains' }, { button: 'confirm', match: 'contains' }, { button: 'yes', match: 'contains' }],
        outputs: [{ name: 'status_after', description: 'The record\'s status as the page shows it after the change', checks: null }, { name: 'before', description: 'Its status before', checks: null }],
        approvedBy: names.get(by) ?? by,
      },
    }).returning();
    followUpBatchId = follow!.id;
    await db.insert(routineRunSchema).values(f.items.map((item, i) => ({
      orgId,
      routineId: batch.routineId,
      batchId: follow!.id,
      version: batch.version,
      n: i + 1,
      label: [item.name, item[matchOn]].filter(Boolean).join(' · ') || `Record ${i + 1}`,
      status: 'queued' as const,
      input: Object.fromEntries(Object.entries(item).filter(([, v]) => v)),
      idemKey: `${verb}:${matchOn}=${(item[matchOn] ?? '').toLowerCase()}`,
    })));
    void r;
  }
  const findings = (batch.findings ?? []).map(x => (x.id === findingId ? { ...x, state: 'answered' as const, answer, followUpBatchId } : x));
  await db.update(routineBatchSchema).set({ findings }).where(eq(routineBatchSchema.id, batchId));
  pushLive(orgId, { routineId: batch.routineId, batchId });
  if (followUpBatchId) {
    pushLive(orgId, { batchId: followUpBatchId });
    await dispatch(orgId);
    if (batch.conversationId) {
      const { tellConversation } = await import('@/services/chat/tellConversation');
      await tellConversation(orgId, batch.conversationId, `Started ${batchLabel(followUpBatchId)}: ${verb} the ${findings.find(x => x.id === findingId)?.items.length ?? 0} records not on the list, as the expert answered. [Open ${batchLabel(followUpBatchId)}](/dashboard/routines/batches/${followUpBatchId})`, { key: `routine-batch:${followUpBatchId}:started`, url: `/dashboard/routines/batches/${followUpBatchId}` }).catch(() => {});
    }
  }
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function mins(ms: number): string {
  const m = ms / 60_000;
  return m < 10 ? `${m.toFixed(1)} min` : `${Math.round(m)} min`;
}

/**
 * A batch's report as markdown: results, time against the manual baseline, cost, escalations and
 * findings, each number traced to its runs.
 * @param v - The batch.
 * @param followUps - Batches its findings started.
 */
export function reportMarkdown(v: RoutineBatchView, followUps: RoutineBatchView[] = []): string {
  const c = v.counts;
  const done = c.done ?? 0;
  const runLink = (x: { n: number; browserRunId: number | null }) => (x.browserRunId ? `[${x.n}](/dashboard/browser/${x.browserRunId})` : String(x.n));
  const wall = v.endedAt ? Date.parse(v.endedAt) - Date.parse(v.startedAt) : Date.now() - Date.parse(v.startedAt);
  const byHand = v.manualMinutes ? v.manualMinutes * (done + (c.escalated ?? 0)) : null;
  const human = v.humanMs;
  const escalated = v.runs.filter(x => x.receipt?.approvedBy && x.waiting === null && x.summary && /expert/i.test(x.summary)).length;
  const lines = [
    `# ${batchLabel(v.id)} · ${v.routine.name}`,
    `Version ${v.routine.version} · ${TRUST_LABEL[v.routine.trust]} trust · expert ${v.routine.expert ?? 'not named'}${v.requestedBy ? ` · run by ${v.requestedBy}` : ''} · started ${new Date(v.startedAt).toUTCString()}`,
    '',
    '## Results',
    `- **${v.total}** rows: **${done}** done and verified by read-back, ${c.skipped ?? 0} skipped, ${(c.escalated ?? 0) + (c.waiting ?? 0)} still waiting on the expert, ${c.failed ?? 0} failed, ${c.unknown_outcome ?? 0} to check by hand.`,
    `- Wall clock: ${mins(wall)} for the whole batch, runs in parallel.`,
    '',
    '## Time',
    byHand !== null ? `- By hand: about ${Math.round(byHand)} min (${v.manualMinutes} min per run, from the recording, × ${done + (c.escalated ?? 0)} runs).` : '- By hand: no baseline on this routine yet.',
    `- People spent about ${mins(human)} answering its escalations and held steps (each counted up to 2 min; the rest of a wait is time they were elsewhere).`,
    byHand !== null ? `- Capacity recovered: about ${Math.max(0, Math.round(byHand - human / 60_000))} min.` : '',
    '',
    '## Cost',
    `- Run cost ${usd(v.cents)} in total, ${v.total ? usd(Math.round(v.cents / v.total)) : '$0.00'} per run (model calls of each browser run).`,
    '',
  ];
  const asked = v.runs.filter(x => /expert answered/i.test(x.summary ?? '') || x.status === 'skipped' || x.status === 'escalated' || x.status === 'unknown_outcome');
  if (asked.length > 0) {
    lines.push('## Escalations and skips', '| Run | Row | What happened |', '| --- | --- | --- |', ...asked.map(x => `| ${runLink(x)} | ${x.label} | ${(x.summary ?? x.error ?? x.status).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 300)} |`), '');
  }
  for (const f of v.findings) {
    lines.push(`## Finding: ${f.title}`, f.detail, '');
    if (f.items.length > 0) {
      const cols = [...new Set(f.items.flatMap(x => Object.keys(x)))].slice(0, 5);
      lines.push(`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...f.items.map(x => `| ${cols.map(k => (x[k] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`), '');
    }
    if (f.state === 'answered') {
      const fu = followUps.find(b => b.id === f.followUpBatchId);
      lines.push(`The expert answered: **${f.answer}**.${fu ? ` ${batchLabel(fu.id)}: ${batchStatusLine(fu)}.` : ''}`, '');
    } else if (f.state === 'open') {
      lines.push('Waiting on the expert: deactivate, delete, or leave them.', '');
    }
  }
  lines.push('## Every run', '| Run | Row | Status | Verified | Summary |', '| --- | --- | --- | --- | --- |', ...v.runs.map(x => `| ${runLink(x)} | ${x.label} | ${x.status.replace(/_/g, ' ')} | ${x.receipt ? (x.receipt.verified ? 'yes' : 'no') : '—'} | ${(x.summary ?? x.error ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200)} |`));
  void escalated;
  return lines.filter(l => l !== undefined).join('\n');
}

/**
 * Build (or rebuild) a batch's report as an artifact, filed on the batch.
 * @param orgId - The workspace.
 * @param userId - The person asking.
 * @param batchId - The batch.
 */
export async function buildRoutineReport(orgId: string, userId: string, batchId: number): Promise<{ artifactId: number; url: string; markdown: string }> {
  const v = await getBatch(orgId, batchId);
  if (!v) {
    throw new RoutineError(`No ${batchLabel(batchId)} in this workspace.`);
  }
  const followIds = v.findings.map(f => f.followUpBatchId).filter((x): x is number => typeof x === 'number');
  const followUps = (await Promise.all(followIds.map(id => getBatch(orgId, id)))).filter((x): x is RoutineBatchView => Boolean(x));
  const md = reportMarkdown(v, followUps);
  const { createArtifact } = await import('@/services/ArtifactService');
  const { artifact } = await createArtifact({
    orgId,
    conversationId: v.conversationId,
    kind: 'markdown',
    title: `${batchLabel(batchId)} · ${v.routine.name} — report`,
    spec: { title: `${batchLabel(batchId)} · ${v.routine.name}`, md },
    record: { type: 'routine_batch', id: String(batchId), role: `report:${Date.now()}` },
    author: { kind: 'human', id: userId },
    changeSummary: 'Routine batch report',
  });
  await db.update(routineBatchSchema).set({ reportArtifactId: artifact.id }).where(eq(routineBatchSchema.id, batchId));
  pushLive(orgId, { batchId });
  return { artifactId: artifact.id, url: `/dashboard/artifacts/${artifact.id}`, markdown: md };
}

/* ------------------------------------------------------------------ */
/* The keeper                                                          */
/* ------------------------------------------------------------------ */

let keeper: ReturnType<typeof setInterval> | null = null;

/**
 * Every few seconds from boot (`instrumentation.ts`): look for the recording a launched teaching
 * session waits for, and start queued runs a restart left behind.
 */
export function startRoutineKeeper(): void {
  if (keeper) {
    return;
  }
  const sweep = async () => {
    const waiting = await db.select().from(routineSchema).where(eq(routineSchema.status, 'teaching')).limit(20).catch(() => [] as RoutineRow[]);
    for (const r of waiting) {
      if (r.teaching?.state === 'waiting_for_recording') {
        await lookForRecording(r).catch(e => console.warn('[routines] could not look for a recording', { routine: r.id, reason: (e as Error).message }));
      } else if ((r.teaching?.state === 'reading' || r.teaching?.state === 'drafting') && !teaching.has(r.id) && Date.now() - r.updatedAt.getTime() > 5 * 60_000) {
        // A restart lost the teaching in flight: start it again.
        teachInBackground(r.id);
      }
    }
    const orgs = await db.selectDistinct({ orgId: routineRunSchema.orgId }).from(routineRunSchema).where(eq(routineRunSchema.status, 'queued')).limit(50).catch(() => [] as Array<{ orgId: string }>);
    for (const o of orgs) {
      await dispatch(o.orgId);
    }
  };
  keeper = setInterval(() => void sweep(), 15_000);
  keeper.unref?.();
  setTimeout(() => void sweep(), 5_000).unref?.();
}

async function lookForRecording(r: RoutineRow): Promise<void> {
  const t = r.teaching!;
  // A session nobody finished in two hours stops looking.
  if (Date.now() - Date.parse(t.startedAt) > 2 * 60 * 60_000) {
    await touch(r.id, { teaching: { ...t, state: 'failed' }, error: 'No recording arrived within two hours. Paste the Slate link, or teach it again.' });
    pushLive(r.orgId, { routineId: r.id });
    return;
  }
  const { slateCredentialsForOrg } = await import('@/libs/slate/recording');
  const creds = await slateCredentialsForOrg(r.orgId, t.userId);
  const lastCheckedAt = new Date().toISOString();
  if (!creds.ok) {
    await touch(r.id, { teaching: { ...t, checks: t.checks + 1, lastCheckedAt }, error: creds.message });
    return;
  }
  let found: { url: string; ready: boolean; status: string; transcript: string; createdAt: string } | null = null;
  try {
    const watch = await import('@/libs/slate/watch');
    const res = await watch.findNewRecording(creds.credentials, { since: new Date(Date.parse(t.startedAt) - 60_000), titleHint: r.name });
    found = res.ok ? res.data : null;
  } catch {
    found = null;
  }
  // Ready, or processed with no transcript coming (a silent take) for a few minutes: read it as it is.
  if (found?.ready || (found && found.status === 'ready' && found.transcript === 'none' && Date.now() - Date.parse(found.createdAt) > 3 * 60_000)) {
    await attachRecording(r.orgId, t.userId, r.id, found.url);
    return;
  }
  await touch(r.id, { teaching: { ...t, checks: t.checks + 1, lastCheckedAt }, error: null });
  pushLive(r.orgId, { routineId: r.id });
}

export { clock };

/**
 * The practice routine, taught and approved: add a user and enroll them, on the practice console,
 * at Approved trust with this person as its expert. One per workspace; asked again, the same one.
 * @param orgId - The workspace.
 * @param userId - The person: its expert.
 */
export async function createPracticeRoutine(orgId: string, userId: string): Promise<RoutineView> {
  const { PRACTICE_ROUTINE_NAME, PRACTICE_ROUTINE_SPEC } = await import('./practice');
  const [existing] = await db.select({ id: routineSchema.id }).from(routineSchema).where(and(eq(routineSchema.orgId, orgId), eq(routineSchema.name, PRACTICE_ROUTINE_NAME), ne(routineSchema.status, 'retired'))).limit(1);
  if (existing) {
    return (await getRoutine(orgId, existing.id))!;
  }
  const slug = await uniqueSlug(orgId, PRACTICE_ROUTINE_NAME);
  const spec: RoutineSpec = { ...PRACTICE_ROUTINE_SPEC, questions: PRACTICE_ROUTINE_SPEC.questions.map(q => ({ ...q, answeredBy: userId })) };
  const [r] = await db.insert(routineSchema).values({
    orgId,
    slug,
    name: PRACTICE_ROUTINE_NAME,
    description: 'Practice: add each person on a roster to the training console if they are missing, then enroll them in a campaign.',
    status: 'live',
    trust: 'approved',
    expertUserId: userId,
    createdBy: userId,
    source: null,
  }).returning();
  await db.insert(routineVersionSchema).values({ orgId, routineId: r!.id, n: 1, status: 'approved', spec, task: compileTask(PRACTICE_ROUTINE_NAME, spec), workflowYaml: workflowYamlFor(slug, PRACTICE_ROUTINE_NAME, 1, spec), approvedBy: userId, approvedAt: new Date() });
  return (await getRoutine(orgId, r!.id))!;
}
