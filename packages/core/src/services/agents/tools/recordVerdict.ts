/**
 * record_verdict — QA's verdict on a pull request, as one typed call.
 *
 * WHY (red team, 2026-09-26): the reviewer read request #131, its plan, PR #50
 * and the after-shot, then ended its run without writing anything. The skill
 * said "write the verdict on the task through update_object"; the model did
 * not, the verdict lived only in prose nobody reads, and the feature sat at
 * "Awaiting QA; no action needed from you" with a finished PR under it. Prompt
 * wording is not a mechanism, so the verdict is a tool whose call IS the
 * review's output, and the automation that runs the review requires it
 * (`do.requireTool`).
 *
 * The model says what it judged; the server says what that means:
 * - the head is read from the code host with the workspace token, never typed by the model;
 * - the count ("4 of 6 proven") is computed from the criteria, never claimed;
 * - an approve with an unproven criterion or a blocking finding is refused;
 * - on approve the merge card (`git.merge`) is filed in the same call, so
 *   there is no second step to forget;
 * - the verdict is mirrored onto the pull request as a review on the code
 *   host (`repo.submit_review`), so the repository's engineers read it too.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MERGE_ACTION_ID, MERGE_PROPOSAL_CONFIDENCE } from '@/libs/actions/mergeAction';
import { alignToContract, contractOf } from '@/libs/workspace/featureProof';

/**
 * A list the model may have sent as JSON text, read as the list; anything
 * else is an empty list for the rules to refuse.
 * @param v - The raw value.
 */
export function parseJsonArray(v: unknown): unknown[] {
  if (Array.isArray(v)) {
    return v;
  }
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export { alignToContract, contractOf };

export const VERDICT_VALUES = ['approve', 'changes', 'reject'] as const;
export const CRITERION_STATUSES = ['proven', 'unproven', 'unchecked'] as const;

export type VerdictCriterion = { criterion: string; status: typeof CRITERION_STATUSES[number]; evidence?: string; tests?: string[] };
export type VerdictFinding = { against: 'criterion' | 'path' | 'check'; ref: string; severity: 'block' | 'fix' | 'note'; what: string; closeBy?: string };

/** What a verdict's value moves the task to. */
export const TASK_STATUS_FOR: Record<typeof VERDICT_VALUES[number], string> = {
  approve: 'accepted',
  changes: 'changes_requested',
  reject: 'rejected',
};

/**
 * Evidence a person can open: a URL, or a test named as a test.
 * @param evidence - What the reviewer cited.
 * @param shotIds - The task's own screenshot artifact ids: citing one by its bare number is one move away.
 */
export function reachable(evidence: string, shotIds: ReadonlySet<number> = new Set()): boolean {
  // Review 5737 looked at the task's screenshots and cited "1008: query 'msa'
  // narrows 3 results to 1" — screenshot 1008 of that task — and was refused
  // as a description. A number that is one of THIS task's screenshots is the
  // screenshot; any other bare number still is not.
  if ([...evidence.matchAll(/\b(\d{2,})\b/g)].some(m => shotIds.has(Number(m[1])))) {
    return true;
  }
  // An artifact number in this workspace ("artifacts 978/979") is one move
  // away too: the recording pass that had just looked at the shots cited them
  // that way and was refused as "a description" (review 5650, 2026-09-27).
  return /https?:\/\/\S+/.test(evidence) || /\bartifacts?\s*#?\d+/i.test(evidence) || /[\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?\b/.test(evidence) || /\b(?:describe|it|test)\(\s*['"`]/.test(evidence);
}

/**
 * The rules a verdict must satisfy, applied before anything is written.
 * @param value - The verdict.
 * @param criteria - Every acceptance criterion, judged.
 * @param findings - Typed findings.
 * @param shotIds - The task's own screenshot artifact ids.
 * @returns The count, and the refusal when the verdict contradicts itself.
 */
export function judgeVerdict(value: string, criteria: VerdictCriterion[], findings: VerdictFinding[], shotIds: ReadonlySet<number> = new Set()): { proven: number; total: number; refusal: string | null; value?: string; recordedAs?: string } {
  const total = criteria.length;
  const proven = criteria.filter(c => c.status === 'proven').length;
  if (total === 0) {
    return { proven, total, refusal: 'Not recorded: a verdict lists every acceptance criterion on the contract, judged proven, unproven or unchecked. Pass them as `criteria`.' };
  }
  // A cited test from the stored run is evidence in itself; whether it exists and passed is
  // {@link citedTestsRefusal}'s to say.
  const cites = (c: VerdictCriterion) => Array.isArray(c.tests) && c.tests.length > 0;
  const provenWithoutEvidence = criteria.filter(c => c.status === 'proven' && !c.evidence?.trim() && !cites(c));
  if (provenWithoutEvidence.length > 0) {
    return { proven, total, refusal: `Not recorded: "${provenWithoutEvidence[0]!.criterion}" is marked proven with no evidence. Name the link, check or screenshot that settles it, or mark it unproven.` };
  }
  // EVIDENCE YOU CAN REACH (principle 3). On #131 attempt 170 every "proven"
  // cited the worker's own caption ("the empty state reads No documents
  // match") and QA opened no image: that is the engineer's account of its
  // work, not evidence. Proven cites something a person can open in one move
  // — a link (the screenshot's page) or a named test.
  const unreachable = criteria.filter(c => c.status === 'proven' && !cites(c) && !reachable(c.evidence ?? '', shotIds));
  if (unreachable.length > 0) {
    return { proven, total, refusal: `Not recorded: "${unreachable[0]!.criterion}" is marked proven on "${(unreachable[0]!.evidence ?? '').slice(0, 80)}", which is a description, not evidence. Cite the screenshot's link (open it with fetch_image first) or the named test, or mark it unproven.` };
  }
  if (value === 'approve') {
    const open = criteria.filter(c => c.status !== 'proven');
    // AN APPROVE WITH SOMETHING UNPROVEN IS A CHANGES (2026-09-30, #130 review
    // 9025: QA approved 7 of 8, was refused, the recording pass approved again
    // and was refused again, and the task sat "QA could not finish" asking a
    // person to Build again). The evidence allows one verdict, so that is the
    // one recorded, and the next attempt is sent back with the open criteria.
    if (open.length > 0) {
      return { proven, total, refusal: null, value: 'changes', recordedAs: `Recorded as changes, not approve: ${open.length} of ${total} criteria are not proven (first: "${open[0]!.criterion}"), so the next attempt proves ${open.length === 1 ? 'it' : 'them'}.` };
    }
    const block = findings.find(f => f.severity === 'block');
    if (block) {
      return { proven, total, refusal: null, value: 'changes', recordedAs: `Recorded as changes, not approve: a blocking finding is open ([${block.against}] ${block.ref}: ${block.what}).` };
    }
  }
  return { proven, total, refusal: null };
}

/** One test the worker's stored run says ran on the branch (`spec.tests` of the qa-test-run). */
export type RanTest = { id: string; file: string; name: string; status: string };

/**
 * The tests that ran, as a list a reviewer picks from.
 * @param tests - The stored run's tests.
 * @param max - At most this many lines.
 */
export function ranTestList(tests: RanTest[], max = 80): string {
  const lines = tests.slice(0, max).map(t => `- ${t.id} ${t.status}: ${t.file} › ${t.name}`);
  return [...lines, ...(tests.length > max ? [`- and ${tests.length - max} more (open the run)`] : [])].join('\n');
}

/**
 * CITE WHAT RAN (Walk 10, 2026-10-02, FE-381 task 383): QA judged three
 * criteria on test names that matched nothing that ran and spent an attempt
 * sending them back. A criterion's `tests` are ids (or exact names) from the
 * worker's stored list of every test that ran on the branch; one not on the
 * list is refused with the list, and a proven criterion may not stand on a
 * test that did not pass.
 * @param criteria - The criteria, aligned to the contract.
 * @param run - The task's stored run: its artifact id and the tests that ran; null when there is none.
 * @param run.id - The artifact.
 * @param run.tests - The tests that ran.
 * @returns The refusal, or null.
 */
export function citedTestsRefusal(criteria: VerdictCriterion[], run: { id: number; tests: RanTest[] } | null): string | null {
  const citing = criteria.filter(c => Array.isArray(c.tests) && c.tests.length > 0);
  if (citing.length === 0) {
    return null;
  }
  // No stored list to check against is the pipeline's gap, not QA's: the
  // citations stand (Walk 11, task 389: two reviews refused, the feature stalled).
  if (!run || run.tests.length === 0) {
    return null;
  }
  const find = (cite: string) => {
    const c = cite.trim();
    return run.tests.find(t => t.id === c) ?? run.tests.find(t => t.name === c || t.name.endsWith(` > ${c}`));
  };
  for (const c of citing) {
    for (const cite of c.tests!) {
      const t = find(cite);
      if (!t) {
        return `Not recorded: "${c.criterion}" cites the test "${cite.slice(0, 160)}", which is not one of the tests that ran on this branch (artifact #${run.id}). Cite tests from this list by id, or mark the criterion unproven:\n${ranTestList(run.tests)}`;
      }
      if (c.status === 'proven' && t.status !== 'passed') {
        return `Not recorded: "${c.criterion}" is marked proven on ${t.id} (${t.name.slice(0, 160)}), which ${t.status === 'failed' ? 'failed' : 'was skipped'} on this branch. A test that did not pass proves nothing; cite one that passed or mark the criterion unproven.`;
      }
    }
  }
  return null;
}

/**
 * The note without a count of its own. The server counts (N of M over the
 * frozen contract); a note that restates a different number — "4 of 6
 * criteria proven" under a recorded 3 of 8, on #131 attempt 168 — makes the
 * page read "QA proved 3 of 8: 4 of 6 proven". The words stay; the number goes.
 * @param note - QA's sentence.
 */
export function noteWithoutCount(note: string): string {
  const cut = note.trim().replace(/^\d+\s+of\s+\d+\s+(?:frozen\s+|acceptance\s+)?criteria\s+(?:are\s+)?proven\s*[:;,.\u2014-]*\s*/i, '');
  return cut ? cut.charAt(0).toUpperCase() + cut.slice(1) : note.trim();
}

/**
 * The note, at most 400 characters, cut at a word.
 * @param note - QA's sentence.
 */
export function clipNote(note: string): string {
  return note.length <= 400 ? note : `${note.slice(0, 399).replace(/\s+\S*$/, '')}…`;
}

/**
 * The merge card's summary: the note, the count, then each criterion with its
 * evidence, so the person merging reads the proof without opening the run.
 * @param note - QA's one sentence.
 * @param criteria - The judged criteria.
 * @param proven - How many are proven.
 */
export function mergeSummary(note: string, criteria: VerdictCriterion[], proven: number): string {
  const lines = criteria.map(c => `- ${c.status === 'proven' ? 'Proven' : c.status === 'unproven' ? 'Unproven' : 'Unchecked'}: ${c.criterion}${c.evidence ? ` (${c.evidence})` : ''}`);
  return [`${note.trim()}`, '', `QA: ${proven} of ${criteria.length} criteria proven.`, ...lines].join('\n').slice(0, 4_000);
}

/**
 * THE VERDICT, MIRRORED WHERE THE ENGINEERS READ IT. The verdict decides the
 * merge card in Vocion; the same judgement goes onto the pull request as a
 * review on the code host (`repo.submit_review`), so a repository's own
 * engineers see it in the tool they already use. Approve → approve; changes
 * and reject → request changes (a rejected contract still means the change
 * does not go in as it is). The body is the note, the count and every
 * finding keyed to what it is against; no inline comments, because the
 * verdict's findings are keyed to criteria, not to lines.
 * @param v - What was judged.
 * @param v.url - The pull request.
 * @param v.value - The verdict.
 * @param v.note - The reviewer's sentence.
 * @param v.proven - Criteria proven.
 * @param v.total - Criteria in the contract.
 * @param v.findings - Findings keyed to the contract.
 * @param v.taskId - The task the verdict is on.
 */
export function reviewMirrorInput(v: { url: string; value: typeof VERDICT_VALUES[number]; note: string; proven: number; total: number; findings: VerdictFinding[]; taskId: number }): { url: string; event: 'approve' | 'request_changes'; body: string; taskId: number; recordId: number } {
  const lines = [
    `**QA verdict: ${v.value}** — ${v.proven} of ${v.total} criteria proven.`,
    v.note.trim(),
    ...(v.findings.length > 0 ? ['', ...v.findings.map(f => `- [${f.severity}] against ${f.against} \`${f.ref}\`: ${f.what}${f.closeBy ? ` Close by: ${f.closeBy}` : ''}`)] : []),
    '',
    `_Recorded on task #${v.taskId} in Vocion; the merge is decided there by a person._`,
  ];
  return { url: v.url, event: v.value === 'approve' ? 'approve' : 'request_changes', body: lines.join('\n').slice(0, 20_000), taskId: v.taskId, recordId: v.taskId };
}

/**
 * Propose the review mirror, done for you or on a card by the workspace's
 * trust rule. Never throws: a refusal (no code host connected for the pull
 * request, a rule that holds it) becomes a clause in the verdict's receipt.
 * @param orgId - The workspace.
 * @param by - The reviewing agent's slug.
 * @param input - From {@link reviewMirrorInput}.
 * @param count - The "N of M criteria proven" line, for the rationale.
 */
export async function mirrorVerdictOnPull(orgId: string, by: string, input: ReturnType<typeof reviewMirrorInput>, count: string): Promise<string> {
  try {
    const { proposeAction } = await import('@/services/ActionService');
    const { SUBMIT_REVIEW_ACTION_ID } = await import('@/libs/actions/repo-submit-review');
    const res = await proposeAction({
      orgId,
      actionId: SUBMIT_REVIEW_ACTION_ID,
      input,
      principal: { kind: 'agent', id: `agent:${by}`, scope: { orgId }, grants: ['*'], autonomy: 2 },
      invokedBy: `agent:${by}`,
      proposal: { confidence: 0.9, rationale: `QA's verdict, mirrored as a review on the pull request: ${count}.`, agentSlug: by, suggestedDecision: 'approve', suggestedDecisionReason: 'The verdict is recorded; the review repeats it where the engineers read.' },
    });
    return res.status === 'pending'
      ? `The review on the pull request waits on a card (run #${res.runId}).`
      : `The verdict is also on the pull request as a review (run #${res.runId}, ${res.status}).`;
  } catch (err) {
    return `The review on the pull request was not filed: ${(err as Error).message}`;
  }
}

export async function findTaskByPr(orgId: string, prUrl: string) {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const url = prUrl.trim().replace(/\/(files|commits|checks)\/?$/, '').replace(/\/$/, '');
  const [row] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, 'engineering_task'), sql`${businessObjectSchema.metadata}->>'prUrl' = ${url}`))
    .orderBy(sql`${businessObjectSchema.id} desc`)
    .limit(1);
  return row ? { ...row, meta: (row.meta ?? {}) as Record<string, unknown>, url } : null;
}

async function writeTask(orgId: string, id: number, set: Record<string, unknown>) {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  // The stage lives on the record's status COLUMN — the worker writes it and
  // the rollups read it; writing only the metadata copy left the request's
  // counts saying "awaiting review" under a verdict (2026-09-26).
  await db
    .update(businessObjectSchema)
    .set({ ...(typeof set.status === 'string' ? { status: set.status } : {}), metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

/**
 * QA COULD NOT FINISH: the review ended without a verdict, even after the
 * recording pass. The task says so (status review_failed), so the Work row
 * stops reading "no action needed". A later verdict overwrites it.
 * @param orgId - The workspace.
 * @param prUrl - The pull request the review was about.
 * @returns The task marked, or null when no waiting task carries the PR.
 */
export async function markReviewFailed(orgId: string, prUrl: string): Promise<number | null> {
  const task = await findTaskByPr(orgId, prUrl);
  const status = task ? String((task as { status?: string }).status ?? task.meta.status ?? '') : '';
  if (!task || status !== 'awaiting_review') {
    return null;
  }
  // Only WHEN, never the refusal text: review 5746 read the last review's
  // refusal off this record and judged the work by it ("the task's own
  // reviewFailure record names the criterion"). The reason stays on the
  // automation fire's error, where the mechanism is debugged.
  await writeTask(orgId, task.id, { status: 'review_failed', reviewFailure: { at: new Date().toISOString() } });
  const { recomputeRollupsForObject } = await import('@/services/objects/rollups');
  await recomputeRollupsForObject(orgId, task.id).catch(() => undefined);
  return task.id;
}

/** Where a sent-back attempt goes next. */
export type SendBack = {
  to: 'engineer' | 'plan';
  why: string;
  note?: string;
  /** What sent it back, when it was not QA (a red CI): the attempt's line on the feature page. */
  reason?: string;
  /** Who sent it back, for the stop line; QA when omitted. */
  by?: string;
};

/**
 * WHERE A SEND-BACK GOES (Chris, 2026-09-29: "does our flow handle a QA send
 * back to plan/eng?"). The engineer by default; planning when QA says the plan
 * cannot be built as written, or — whatever QA said — when the same criterion
 * stayed unproven on two attempts in a row under one plan, because a third
 * build to the same plan repeats the second (#224: "a visible confirmation"
 * open on attempts 2 and 3 of plan #236).
 * @param input - The verdict just recorded and the attempt before it.
 * @param input.asked - QA's own `send_back_to`.
 * @param input.why - QA's reason for it.
 * @param input.criteria - This verdict's criteria.
 * @param input.planId - The plan this attempt was built to.
 * @param input.previous - The attempt this one superseded: its verdict's criteria and its plan.
 * @param input.previous.criteria
 * @param input.previous.planId
 */
export function sendBackRoute(input: { asked?: 'engineer' | 'plan' | null; why?: string | null; criteria: VerdictCriterion[]; planId: number | null; previous?: { criteria: VerdictCriterion[]; planId: number | null } | null }): SendBack {
  if (input.asked === 'plan') {
    return { to: 'plan', why: input.why?.trim() || 'QA read the plan as what stands in the way.' };
  }
  const prev = input.previous;
  if (prev && input.planId !== null && prev.planId === input.planId) {
    const open = (list: VerdictCriterion[]) => new Set(list.filter(c => c.status !== 'proven').map(c => c.criterion.trim().toLowerCase()));
    const before = open(prev.criteria);
    const twice = input.criteria.filter(c => c.status !== 'proven' && before.has(c.criterion.trim().toLowerCase())).map(c => c.criterion);
    if (twice.length > 0) {
      return { to: 'plan', why: `${twice.length === 1 ? 'a criterion' : `${twice.length} criteria`} stayed unproven on two attempts in a row under plan #${input.planId}: ${twice.slice(0, 3).map(c => `"${c}"`).join('; ')}` };
    }
  }
  return { to: 'engineer', why: input.why?.trim() || 'QA named what would settle each open criterion.' };
}

/**
 * BUILD AGAIN, DONE FOR YOU (Chris, 2026-09-26: "auto Build again, yes").
 * When QA sends back an attempt a person started, the next attempt starts on
 * its own, carrying the verdict (deriveContract). It is proposed as
 * `factory.dispatch_task.retry`, so the workspace's trust rule decides whether
 * it runs at once (with Undo) or waits on a card; an attempt that was itself
 * a retry is never retried again, so one press of Build is at most two.
 * @param orgId - The workspace.
 * @param task - The task QA just sent back.
 * @param task.id
 * @param task.meta
 * @param route
 * @returns One sentence for the verdict's receipt, or null when nothing started.
 */
export async function buildAgain(orgId: string, task: { id: number; meta: Record<string, unknown> }, route: SendBack = { to: 'engineer', why: '' }): Promise<string | null> {
  const requestId = Number(task.meta.requestId);
  // A re-plan is a different step from a rebuild, so a retry may still send
  // its work back to planning; the three-per-request limit bounds both.
  // Bounded by the per-stage limit (stopIfAtLimit), not by "a retry of a
  // retry is a person's call" (2026-09-30: that rule parked a build a third
  // attempt would have fixed).
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return null;
  }
  try {
    // AN ATTEMPT THAT IS HISTORY IS NEVER BUILT AGAIN, and never files a stop
    // either: a later attempt replaced it, or the request has settled.
    const { attemptIsHistory } = await import('@/services/factory/supersededPulls');
    const history = await attemptIsHistory(orgId, task);
    if (history) {
      return `Nothing built again: attempt #${task.id} is history (${history}).`;
    }
    // ONE LIMIT FOR EVERY AUTOMATIC STEP (backlog 038): a QA send-back retry
    // counts toward the same three per request as a recovery does.
    // A request its durable workflow owns is counted there (backlog 054): the
    // send-back is told to the workflow, which numbers the next attempt.
    const { readRecord } = await import('@/libs/actions/factory-dispatch');
    const { ownedByWorkflow } = await import('@/services/factory/requestWorkflowStart');
    const owner = await readRecord(orgId, requestId);
    if (!owner || !(await ownedByWorkflow(orgId, owner.meta))) {
      const { stopIfAtLimit } = await import('@/services/factory/carry');
      const stopped = await stopIfAtLimit(orgId, requestId, `${route.by ?? 'QA'} sent attempt #${task.id} back`);
      if (stopped) {
        return stopped;
      }
    }
    const { proposeAction } = await import('@/services/ActionService');
    const planId = Number(task.meta.planId);
    const hasPlan = Number.isFinite(planId) && planId > 0;
    const toPlan = route.to === 'plan'
      ? (hasPlan ? { replan: route.why.slice(0, 1500) } : { planFirst: `QA sent attempt #${task.id} back to planning: ${route.why}`.slice(0, 1000) })
      : {};
    const res = await proposeAction({
      orgId,
      actionId: 'factory.dispatch_task',
      input: { requestId, ...(hasPlan ? { planId } : {}), autoRetryOf: task.id, ...toPlan, ...(route.note ? { note: route.note.slice(0, 4000) } : {}), reason: route.reason?.slice(0, 500) ?? (route.to === 'plan' ? `QA sent attempt #${task.id} back to planning: ${route.why}`.slice(0, 500) : `QA sent attempt #${task.id} back; the next attempt carries what would settle each criterion.`) },
      principal: { kind: 'agent', id: 'agent:product-manager', scope: { orgId }, grants: ['*'], autonomy: 2 },
      invokedBy: 'agent:product-manager',
      // Core's own retry, not the model's: `autoRetryOf` is kept.
      internal: true,
      proposal: { confidence: 0.9, rationale: `QA sent attempt #${task.id} back with named gaps; one automatic retry carries them.`, agentSlug: 'product-manager', suggestedDecision: 'approve', suggestedDecisionReason: 'One automatic retry after changes asked.' },
    });
    const what = route.to === 'plan' ? `Planning again (${route.why})` : 'Build again';
    return res.status === 'pending'
      ? `${what} is on a card for a person (run #${res.runId}).`
      : `${what} started on its own (run #${res.runId}, ${res.status}); Undo cancels it until a worker claims it.`;
  } catch (err) {
    return `Build again could not start: ${(err as Error).message}`;
  }
}

/**
 * The refusal for a review that opened none of the task's screenshots, or
 * null when it opened one (or there are none, or this is not a review run).
 * @param ctx - The runtime context; `missionRunId` scopes "this review".
 * @param taskId - The task under review.
 */
/**
 * The ids of a task's QA evidence: its screenshots and the stored run of its named tests.
 * @param orgId - The workspace.
 * @param taskId - The task.
 */
async function taskShotIds(orgId: string, taskId: number): Promise<Set<number>> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { artifactSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ id: artifactSchema.id })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.recordId, String(taskId)), sql`${artifactSchema.recordRole} in ('qa-screenshot', 'qa-test-run')`));
  return new Set(rows.map(r => r.id));
}

/**
 * THE TESTS WERE RUN; READ THEM BEFORE CALLING THEM UNPROVEN. The worker runs
 * each named test on the branch and stores the output on the task
 * (qa-test-run). On #131 attempt 185 all three passed and were linked in the
 * PR, and QA still wrote "no integration test log" — it never opened the
 * artifact. The first verdict on a task with a stored run is refused once,
 * with the run's output and link in the refusal, so the next call is taken
 * having read it — whatever it judged (review 5798 marked the scope criterion
 * proven on "CI passed" and was refused twice for a link it was never given).
 * Once per run; never blocks twice.
 * @param ctx - The run's context.
 * @param taskId - The task.
 */
export async function unreadTestRun(ctx: RuntimeContext, taskId: number): Promise<string | null> {
  if (ctx.testRunShown) {
    return null;
  }
  const run = await latestTestRun(ctx.orgId, taskId);
  if (!run || !run.md) {
    return null;
  }
  ctx.testRunShown = true;
  const { appBaseUrl } = await import('@/libs/links');
  // The list of what ran is handed over whole, beside the output, so a citation is picked from it.
  const list = run.tests.length > 0 ? `\n\nEvery test that ran on the branch; cite these by id in a criterion's \`tests\`:\n${ranTestList(run.tests, 120)}` : '';
  return `Not recorded: task #${taskId} has a stored run of its named tests, and this verdict was written without reading it. Its output is below. For each criterion a test covers, judge it on this output and cite ${appBaseUrl()}/dashboard/artifacts/${run.id}${run.tests.length > 0 ? ', with the tests that prove it by id' : ''}; then record the verdict again.\n\n${run.md.slice(0, run.tests.length > 0 ? 6000 : 8000)}${list}`;
}

/**
 * The task's latest stored run of its named tests: the artifact, its markdown and the tests that
 * ran on the branch (`spec.tests`, written by the worker), or null.
 * @param orgId - The workspace.
 * @param taskId - The task.
 */
export async function latestTestRun(orgId: string, taskId: number): Promise<{ id: number; md: string; tests: RanTest[] } | null> {
  const { and, desc, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { artifactSchema } = await import('@/models/Schema');
  const [run] = await db
    .select({ id: artifactSchema.id, spec: artifactSchema.spec })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.recordId, String(taskId)), sql`${artifactSchema.recordRole} = 'qa-test-run'`))
    .orderBy(desc(artifactSchema.id))
    .limit(1);
  if (!run) {
    return null;
  }
  const spec = (run.spec ?? {}) as Record<string, unknown>;
  const tests = (Array.isArray(spec.tests) ? spec.tests : [])
    .filter((t): t is RanTest => Boolean(t) && typeof (t as RanTest).id === 'string' && typeof (t as RanTest).name === 'string')
    .map(t => ({ id: t.id, file: String(t.file ?? ''), name: t.name, status: String(t.status ?? '') }));
  return { id: run.id, md: typeof spec.md === 'string' ? spec.md : '', tests };
}

export async function unopenedShots(ctx: RuntimeContext, taskId: number): Promise<string | null> {
  if (!ctx.missionRunId || ctx.evidenceOpened) {
    return null;
  }
  const { and, eq, like, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { artifactSchema, toolCallSchema } = await import('@/models/Schema');
  const shots = await db
    .select({ id: artifactSchema.id, title: artifactSchema.title })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, ctx.orgId), eq(artifactSchema.recordId, String(taskId)), sql`${artifactSchema.recordRole} = 'qa-screenshot'`, sql`${artifactSchema.url} is not null`));
  if (shots.length === 0) {
    return null;
  }
  const [opened] = await db
    .select({ id: toolCallSchema.id })
    .from(toolCallSchema)
    .where(and(eq(toolCallSchema.orgId, ctx.orgId), eq(toolCallSchema.missionRunId, ctx.missionRunId), eq(toolCallSchema.tool, 'fetch_image'), like(sql`${toolCallSchema.output}::text`, '%verified%')))
    .limit(1);
  if (opened) {
    return null;
  }
  const { appBaseUrl } = await import('@/libs/links');
  const links = shots.map(s => `- ${s.title}: ${appBaseUrl()}/dashboard/artifacts/${s.id}`).join('\n');
  return `Not recorded: task #${taskId} has ${shots.length} screenshots and this review opened none of them. Open the ones each criterion needs with fetch_image, then record the verdict on what they show:\n${links}`;
}

/**
 * The attempt a task superseded, with its verdict's criteria, for {@link sendBackRoute}.
 * @param orgId - The workspace.
 * @param id - `previousTaskId` from the task.
 */
async function previousAttempt(orgId: string, id: unknown): Promise<{ meta: Record<string, unknown>; criteria: VerdictCriterion[] } | null> {
  const taskId = Number(id);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return null;
  }
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const [row] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, taskId))).limit(1);
  const meta = (row?.meta ?? null) as Record<string, unknown> | null;
  const criteria = (meta?.verdict as { criteria?: VerdictCriterion[] } | undefined)?.criteria;
  return meta && Array.isArray(criteria) ? { meta, criteria } : null;
}

export function recordVerdictTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as { pr_url: string; value: typeof VERDICT_VALUES[number]; criteria: unknown; findings?: unknown; note: string; independent_checks?: unknown; send_back_to?: 'engineer' | 'plan'; send_back_reason?: string };
      // THE SHAPE THE MODEL SENDS, accepted (as update_object learned, backlog
      // 006): on the first live verdict (fire 7051) the lists arrived as JSON
      // text. Text that parses to a list IS the list; the rules then judge it.
      const judged = parseJsonArray(args.criteria) as VerdictCriterion[];
      const findings = parseJsonArray(args.findings) as VerdictFinding[];
      const independentChecks = (parseJsonArray(args.independent_checks) as unknown[]).filter((c): c is string => typeof c === 'string');
      const task = await findTaskByPr(ctx.orgId, args.pr_url);
      if (!task) {
        return `Not recorded: no engineering task in this workspace carries the pull request ${args.pr_url}. Pass the task's prUrl exactly as it is on the record.`;
      }
      const { attemptIsHistory } = await import('@/services/factory/supersededPulls');
      const history = await attemptIsHistory(ctx.orgId, task);
      if (history) {
        return `Read as history: task #${task.id} is not the attempt that decides anything (${history}). Its status stays ${String(task.status ?? task.meta.status ?? 'as it was')}, nothing is built again and no merge is filed. The review is done.`;
      }
      // THE CONTRACT IS THE LIST, NOT THE MODEL. On fire 7061 the reviewer
      // wrote three easy criteria of its own and approved "3 of 3" against a
      // contract of eight; a verdict whose criteria the grader picks can
      // always pass. The frozen contract on the task is what is graded: each
      // judgement is paired to a contract line, and a line nobody judged is
      // unchecked — absent is not proven.
      const contract = contractOf(task.meta);
      const criteria = contract.length > 0 ? alignToContract(contract, judged) : judged;
      const { proven, total, refusal: ruled, value: judgedValue, recordedAs } = judgeVerdict(args.value, criteria, findings, await taskShotIds(ctx.orgId, task.id));
      const value = (judgedValue ?? args.value) as typeof VERDICT_VALUES[number];
      // JUDGED WITHOUT LOOKING. On #131 attempt 176 the PR listed seventeen
      // short screenshot links and QA opened none: it read the task through a
      // lookup that clips long fields and called every link "truncated". A
      // verdict on a task that has screenshots is taken only after at least one
      // was opened in this review; the refusal hands over every link, so the
      // evidence is in front of the reviewer with nothing in between.
      // LOOK, THEN CITE. Review 5781 had opened nothing and was refused twice
      // for citing captions instead of links — links it could not have, since
      // the list of screenshots comes only with the "opened none" refusal,
      // which the citation rule reached first. The evidence is handed over
      // before the citations are judged.
      // Everything the review should look at is handed over first, in ONE
      // refusal (screenshots it has not opened, the stored test run it has not
      // read), then the citations are judged against it.
      const handover = [await unopenedShots(ctx, task.id), await unreadTestRun(ctx, task.id)].filter(Boolean).join('\n\n');
      const cited = handover ? null : citedTestsRefusal(criteria, await latestTestRun(ctx.orgId, task.id));
      const refusal = handover || cited || ruled;
      if (refusal) {
        return contract.length > 0 ? `${refusal}\n\nThe contract on task #${task.id}, which is what is graded:\n${contract.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : refusal;
      }
      const { readPullHead } = await import('./githubPullRead');
      const head = await readPullHead(ctx.orgId, task.url);
      const taskSha = typeof task.meta.commitSha === 'string' ? task.meta.commitSha : null;
      const commitSha = head?.sha ?? taskSha;
      if (!commitSha) {
        return `Not recorded: could not read the head of ${task.url} from the code host, and task #${task.id} names no commit. A verdict is about one commit.`;
      }
      if (head?.merged) {
        return `Not recorded: ${task.url} is already merged. A verdict before the merge is the only one that decides anything.`;
      }
      const by = ctx.agentSlug ?? 'change-reviewer';
      const verdict = {
        value,
        commitSha,
        at: new Date().toISOString(),
        by,
        note: clipNote(noteWithoutCount(args.note)),
        proven,
        total,
        criteria,
        findings,
        independentChecks,
      };
      await writeTask(ctx.orgId, task.id, { verdict, status: TASK_STATUS_FOR[value] });
      // The request's counts move with the task, or the Work row keeps saying
      // "Awaiting QA" under a verdict (2026-09-26: rollups only reran on cost).
      const { recomputeRollupsForObject } = await import('@/services/objects/rollups');
      await recomputeRollupsForObject(ctx.orgId, task.id).catch(() => undefined);
      ctx.emit({ type: 'tool_progress', tool: 'record_verdict', meta: { taskId: task.id, value, proven, total } } as never);
      const count = `${proven} of ${total} criteria proven`;
      if (value !== 'approve') {
        // QA sent it back: the request's status says so before any retry
        // goes out (a retry's own start then reads Building).
        const sentBackFor = Number(task.meta.requestId);
        if (Number.isInteger(sentBackFor) && sentBackFor > 0) {
          const { markStatus } = await import('@/services/objects/statusField');
          await markStatus(ctx.orgId, sentBackFor, `qa_${value}`, { line: `QA sent it back: ${count}.` });
        }
        let retry: string | null = null;
        if (value === 'changes') {
          const planOf = (m: Record<string, unknown>) => (Number(m.planId) > 0 ? Number(m.planId) : null);
          const previous = await previousAttempt(ctx.orgId, task.meta.previousTaskId);
          const route = sendBackRoute({ asked: args.send_back_to ?? null, why: args.send_back_reason ?? null, criteria, planId: planOf(task.meta), previous: previous ? { criteria: previous.criteria, planId: planOf(previous.meta) } : null });
          if (route.to === 'plan') {
            await writeTask(ctx.orgId, task.id, { sendBack: route });
          }
          retry = await buildAgain(ctx.orgId, task, route);
        }
        const mirrored = await mirrorVerdictOnPull(ctx.orgId, by, reviewMirrorInput({ url: task.url, value, note: verdict.note, proven, total, findings, taskId: task.id }), count);
        return `${recordedAs ? `${recordedAs} ` : ''}Verdict recorded on task #${task.id}: ${value}, ${count}, at ${commitSha.slice(0, 12)}. The task now reads ${TASK_STATUS_FOR[value]}; the Work page shows what would settle it.${retry ? ` ${retry}` : ''} ${mirrored}`;
      }
      // THE MERGE CARRIES WHAT THE DIFF TOUCHED (2026-09-30). The engineer may
      // go beyond the plan's paths when the outcome needs it; the merge's class,
      // and so its trust rule, is the higher of the task's and the class of the
      // files it changed (the repo's riskDefaults), so a change that reached
      // auth or billing is ruled as auth or billing. One reading, shared with
      // the status facts that say whether the merge runs itself.
      const { mergeRiskClassOf } = await import('@/services/factory/pullSignals');
      const riskClass = await mergeRiskClassOf(ctx.orgId, task.meta);
      const rollback = typeof task.meta.rollback === 'string' && task.meta.rollback.length >= 8
        ? task.meta.rollback.slice(0, 600)
        : 'Revert the pull request and merge the revert; the merge is the deploy, so the revert ships the same way.';
      try {
        const { proposeAction } = await import('@/services/ActionService');
        const res = await proposeAction({
          orgId: ctx.orgId,
          actionId: MERGE_ACTION_ID,
          input: {
            title: `Merge ${task.title}`.slice(0, 200),
            headline: 'QA approved it; merging is the deploy.',
            summary: mergeSummary(verdict.note, criteria, proven),
            steps: [
              { say: 'Open the pull request and merge it.', url: task.url },
              { say: 'The merge deploys it; the release lands in Vocion when it is live.' },
            ],
            evidence: [task.url],
            externalRef: { system: 'github', id: task.url.replace('https://github.com/', ''), url: task.url },
            riskClass,
            commitSha,
            verdictCommitSha: commitSha,
            rollback,
            taskId: task.id,
          },
          principal: { kind: 'agent', id: `agent:${by}`, scope: { orgId: ctx.orgId }, grants: ['*'], autonomy: 2 },
          invokedBy: `agent:${by}`,
          proposal: { confidence: MERGE_PROPOSAL_CONFIDENCE, rationale: verdict.note, agentSlug: by, suggestedDecision: 'approve', suggestedDecisionReason: `${count}. ${verdict.note}`.slice(0, 160) },
        });
        // THE REQUEST'S STAGE SETTLES ON THE CARD (Walk 7, 2026-10-02): a recovery
        // stage left from an earlier failure of this attempt is no longer true once
        // QA approved it; the card says whose move it is now.
        const requestId = Number(task.meta.requestId);
        const { mergeCardLine } = await import('@/services/factory/recovery');
        const settled = mergeCardLine({ proven, total, riskClass, status: res.status });
        if (settled && Number.isInteger(requestId) && requestId > 0) {
          const { settleOnMergeCard } = await import('@/services/factory/carry');
          const now = new Date().toISOString();
          await settleOnMergeCard(ctx.orgId, requestId, settled, now, now, res.status === 'pending').catch((err: Error) => console.warn('record_verdict: settling the request\'s stage failed', { orgId: ctx.orgId, requestId, message: err.message }));
        }
        const mirrored = await mirrorVerdictOnPull(ctx.orgId, by, reviewMirrorInput({ url: task.url, value, note: verdict.note, proven, total, findings, taskId: task.id }), count);
        return `Verdict recorded on task #${task.id}: approve, ${count}, at ${commitSha.slice(0, 12)}. The merge card is filed (run #${res.runId}, ${res.status}); a person merges. ${mirrored}`;
      } catch (err) {
        return `Verdict recorded on task #${task.id} (approve, ${count}), but the merge card was refused: ${(err as Error).message}`;
      }
    },
    {
      name: 'record_verdict',
      description: 'Record QA\'s verdict on a factory pull request: every line of the task\'s acceptance contract (acceptanceContract, in order, in its own words) judged proven, unproven or unchecked, with the evidence for each proven one. A contract line you do not judge is recorded as unchecked. The server binds it to the PR\'s current head, counts the proven criteria itself, sets the task to accepted, changes_requested or rejected, and on approve files the merge card for a person. This call IS the review; a review that does not end in it did not happen.',
      schema: z.object({
        pr_url: z.string().url().describe('The pull request, e.g. https://github.com/acme/app/pull/12.'),
        value: z.enum(VERDICT_VALUES).describe('approve only when every criterion is proven and nothing blocks; changes when something specific would make it right; reject when the contract itself was wrong.'),
        // PLAIN TYPES ONLY (no transforms — they cannot be sent as JSON Schema,
        // #731); a list sent as text is parsed in the handler.
        criteria: z.union([z.array(z.object({
          criterion: z.string().min(1).describe('The acceptance criterion, as written on the contract.'),
          status: z.enum(CRITERION_STATUSES),
          evidence: z.string().optional().describe('The link, check or screenshot that settles it. Required for proven, unless tests names the tests that prove it.'),
          tests: z.array(z.string()).optional().describe('The tests that prove it, by id (e.g. "t3") from the stored run\'s list of every test that ran on the branch. A test not on that list is refused with the list; a proven criterion needs tests that passed.'),
        })), z.string()]).describe('Every acceptance criterion, in contract order, as a list.'),
        findings: z.union([z.array(z.object({
          against: z.enum(['criterion', 'path', 'check']),
          ref: z.string().min(1),
          severity: z.enum(['block', 'fix', 'note']),
          what: z.string().min(1),
          closeBy: z.string().optional(),
        })), z.string()]).optional().describe('Findings keyed to the contract, as a list. block keeps the merge from being proposed.'),
        // No max: review 5710's verdict died on a 520-character note and the
        // task sat in Awaiting QA. A long sentence is clipped, never refused.
        note: z.string().min(1).describe('One sentence for the person who merges: what they accept and the one risk to know.'),
        independent_checks: z.union([z.array(z.string()), z.string()]).optional().describe('Checks that ran on trusted CI or that you reproduced, not the worker\'s report.'),
        send_back_to: z.enum(['engineer', 'plan']).optional().describe('With changes: engineer (default) when a better build of the same plan would settle it; plan when the plan itself stands in the way — wrong component or surface, a path or API it never named, a risk it did not answer.'),
        send_back_reason: z.string().max(600).optional().describe('With send_back_to plan: what about the plan must change, in one or two sentences the planner can act on.'),
      }),
    },
  );
}

/**
 * Granted only (`harness.grantTools: [record_verdict]`), to the reviewer: the
 * seat that dispatched the work never grades it.
 * @param ctx - The runtime context.
 */
export function recordVerdictTools(ctx: RuntimeContext): StructuredToolInterface[] {
  return (ctx.harnessConfig.grantTools ?? []).includes('record_verdict') ? [recordVerdictTool(ctx)] : [];
}
