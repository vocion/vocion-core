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
 * - the head is read from GitHub with the workspace token, never typed by the model;
 * - the count ("4 of 6 proven") is computed from the criteria, never claimed;
 * - an approve with an unproven criterion or a blocking finding is refused;
 * - on approve the merge card (`git.merge`) is filed in the same call, so
 *   there is no second step to forget.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MERGE_RISK_CLASSES } from '@/libs/actions/factory';

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

export const VERDICT_VALUES = ['approve', 'changes', 'reject'] as const;
export const CRITERION_STATUSES = ['proven', 'unproven', 'unchecked'] as const;

export type VerdictCriterion = { criterion: string; status: typeof CRITERION_STATUSES[number]; evidence?: string };
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
 */
export function reachable(evidence: string): boolean {
  return /https?:\/\/\S+/.test(evidence) || /[\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?\b/.test(evidence) || /\b(?:describe|it|test)\(\s*['"`]/.test(evidence);
}

/**
 * The rules a verdict must satisfy, applied before anything is written.
 * @param value - The verdict.
 * @param criteria - Every acceptance criterion, judged.
 * @param findings - Typed findings.
 * @returns The count, and the refusal when the verdict contradicts itself.
 */
export function judgeVerdict(value: string, criteria: VerdictCriterion[], findings: VerdictFinding[]): { proven: number; total: number; refusal: string | null } {
  const total = criteria.length;
  const proven = criteria.filter(c => c.status === 'proven').length;
  if (total === 0) {
    return { proven, total, refusal: 'Not recorded: a verdict lists every acceptance criterion on the contract, judged proven, unproven or unchecked. Pass them as `criteria`.' };
  }
  const provenWithoutEvidence = criteria.filter(c => c.status === 'proven' && !c.evidence?.trim());
  if (provenWithoutEvidence.length > 0) {
    return { proven, total, refusal: `Not recorded: "${provenWithoutEvidence[0]!.criterion}" is marked proven with no evidence. Name the link, check or screenshot that settles it, or mark it unproven.` };
  }
  // EVIDENCE YOU CAN REACH (principle 3). On #131 attempt 170 every "proven"
  // cited the worker's own caption ("the empty state reads No documents
  // match") and QA opened no image: that is the engineer's account of its
  // work, not evidence. Proven cites something a person can open in one move
  // — a link (the screenshot's page) or a named test.
  const unreachable = criteria.filter(c => c.status === 'proven' && !reachable(c.evidence ?? ''));
  if (unreachable.length > 0) {
    return { proven, total, refusal: `Not recorded: "${unreachable[0]!.criterion}" is marked proven on "${(unreachable[0]!.evidence ?? '').slice(0, 80)}", which is a description, not evidence. Cite the screenshot's link (open it with fetch_image first) or the named test, or mark it unproven.` };
  }
  if (value === 'approve') {
    const open = criteria.filter(c => c.status !== 'proven');
    if (open.length > 0) {
      return { proven, total, refusal: `Not recorded: an approve cannot carry ${open.length} criteria that are not proven (${proven} of ${total} proven; first: "${open[0]!.criterion}"). Record changes with what would settle them, or prove them.` };
    }
    const block = findings.find(f => f.severity === 'block');
    if (block) {
      return { proven, total, refusal: `Not recorded: an approve cannot carry a blocking finding ([${block.against}] ${block.ref}: ${block.what}). Record changes or reject.` };
    }
  }
  return { proven, total, refusal: null };
}

/**
 * The acceptance contract on a task, as a list of statements.
 * @param meta - The task's metadata.
 */
export function contractOf(meta: Record<string, unknown>): string[] {
  const raw = Array.isArray(meta.acceptanceContract) ? meta.acceptanceContract : [];
  return raw
    .map(c => (typeof c === 'string' ? c : c && typeof c === 'object' && typeof (c as { statement?: unknown }).statement === 'string' ? (c as { statement: string }).statement : ''))
    .map(c => c.trim())
    .filter(Boolean);
}

function normal(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Pair the reviewer's judgements to the contract, line by line. A judgement
 * matches a line when one's words contain the other's. Never by position: a
 * reviewer that invents as many lines as the contract has would pass it.
 * Every contract line comes back, in contract order, in the contract's own
 * words; a line no judgement named is `unchecked`.
 * @param contract - The frozen contract statements.
 * @param judged - What the reviewer sent.
 */
export function alignToContract(contract: string[], judged: VerdictCriterion[]): VerdictCriterion[] {
  const used = new Set<number>();
  const byText = contract.map((line) => {
    const n = normal(line);
    const i = judged.findIndex((j, k) => {
      if (used.has(k)) {
        return false;
      }
      const m = normal(j.criterion ?? '');
      return m.length >= 12 && (n.includes(m) || m.includes(n) || n.slice(0, 40) === m.slice(0, 40));
    });
    if (i >= 0) {
      used.add(i);
    }
    return i;
  });
  return contract.map((line, idx) => {
    const i = byText[idx]!;
    const j = i >= 0 ? judged[i] : undefined;
    return j ? { criterion: line, status: j.status, ...(j.evidence ? { evidence: j.evidence } : {}) } : { criterion: line, status: 'unchecked' as const };
  });
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

async function findTaskByPr(orgId: string, prUrl: string) {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const url = prUrl.trim().replace(/\/(files|commits|checks)\/?$/, '').replace(/\/$/, '');
  const [row] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, meta: businessObjectSchema.metadata })
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
 * @returns One sentence for the verdict's receipt, or null when nothing started.
 */
export async function buildAgain(orgId: string, task: { id: number; meta: Record<string, unknown> }): Promise<string | null> {
  const requestId = Number(task.meta.requestId);
  if (!Number.isFinite(requestId) || requestId <= 0 || task.meta.autoRetryOf) {
    return task.meta.autoRetryOf ? 'This attempt was already the automatic retry, so the next build is a person\'s call.' : null;
  }
  try {
    const { proposeAction } = await import('@/services/ActionService');
    const planId = Number(task.meta.planId);
    const res = await proposeAction({
      orgId,
      actionId: 'factory.dispatch_task',
      input: { requestId, ...(Number.isFinite(planId) && planId > 0 ? { planId } : {}), autoRetryOf: task.id, reason: `QA sent attempt #${task.id} back; the next attempt carries what would settle each criterion.` },
      principal: { kind: 'agent', id: 'agent:product-manager', scope: { orgId }, grants: ['*'], autonomy: 2 },
      invokedBy: 'agent:product-manager',
      proposal: { confidence: 0.9, rationale: `QA sent attempt #${task.id} back with named gaps; one automatic retry carries them.`, agentSlug: 'product-manager', suggestedDecision: 'approve', suggestedDecisionReason: 'One automatic retry after changes asked.' },
    });
    return res.status === 'pending'
      ? `Build again is on a card for a person (run #${res.runId}).`
      : `Build again started on its own (run #${res.runId}, ${res.status}); Undo cancels it until a worker claims it.`;
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
export async function unopenedShots(ctx: RuntimeContext, taskId: number): Promise<string | null> {
  if (!ctx.missionRunId) {
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

export function recordVerdictTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as { pr_url: string; value: typeof VERDICT_VALUES[number]; criteria: unknown; findings?: unknown; note: string; independent_checks?: unknown };
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
      // THE CONTRACT IS THE LIST, NOT THE MODEL. On fire 7061 the reviewer
      // wrote three easy criteria of its own and approved "3 of 3" against a
      // contract of eight; a verdict whose criteria the grader picks can
      // always pass. The frozen contract on the task is what is graded: each
      // judgement is paired to a contract line, and a line nobody judged is
      // unchecked — absent is not proven.
      const contract = contractOf(task.meta);
      const criteria = contract.length > 0 ? alignToContract(contract, judged) : judged;
      const { proven, total, refusal: ruled } = judgeVerdict(args.value, criteria, findings);
      // JUDGED WITHOUT LOOKING. On #131 attempt 176 the PR listed seventeen
      // short screenshot links and QA opened none: it read the task through a
      // lookup that clips long fields and called every link "truncated". A
      // verdict on a task that has screenshots is taken only after at least one
      // was opened in this review; the refusal hands over every link, so the
      // evidence is in front of the reviewer with nothing in between.
      const refusal = ruled ?? await unopenedShots(ctx, task.id);
      if (refusal) {
        return contract.length > 0 ? `${refusal}\n\nThe contract on task #${task.id}, which is what is graded:\n${contract.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : refusal;
      }
      const { readPullHead } = await import('./githubPullRead');
      const head = await readPullHead(ctx.orgId, task.url);
      const taskSha = typeof task.meta.commitSha === 'string' ? task.meta.commitSha : null;
      const commitSha = head?.sha ?? taskSha;
      if (!commitSha) {
        return `Not recorded: could not read the head of ${task.url} from GitHub, and task #${task.id} names no commit. A verdict is about one commit.`;
      }
      if (head?.merged) {
        return `Not recorded: ${task.url} is already merged. A verdict before the merge is the only one that decides anything.`;
      }
      const by = ctx.agentSlug ?? 'change-reviewer';
      const verdict = {
        value: args.value,
        commitSha,
        at: new Date().toISOString(),
        by,
        note: noteWithoutCount(args.note),
        proven,
        total,
        criteria,
        findings,
        independentChecks,
      };
      await writeTask(ctx.orgId, task.id, { verdict, status: TASK_STATUS_FOR[args.value] });
      // The request's counts move with the task, or the Work row keeps saying
      // "Awaiting QA" under a verdict (2026-09-26: rollups only reran on cost).
      const { recomputeRollupsForObject } = await import('@/services/objects/rollups');
      await recomputeRollupsForObject(ctx.orgId, task.id).catch(() => undefined);
      ctx.emit({ type: 'tool_progress', tool: 'record_verdict', meta: { taskId: task.id, value: args.value, proven, total } } as never);
      const count = `${proven} of ${total} criteria proven`;
      if (args.value !== 'approve') {
        const retry = args.value === 'changes' ? await buildAgain(ctx.orgId, task) : null;
        return `Verdict recorded on task #${task.id}: ${args.value}, ${count}, at ${commitSha.slice(0, 12)}. The task now reads ${TASK_STATUS_FOR[args.value]}; the Work page shows what would settle it.${retry ? ` ${retry}` : ''}`;
      }
      const riskRaw = typeof task.meta.riskClass === 'string' ? task.meta.riskClass : 'logic';
      const riskClass = (MERGE_RISK_CLASSES as readonly string[]).includes(riskRaw) ? riskRaw : 'logic';
      const rollback = typeof task.meta.rollback === 'string' && task.meta.rollback.length >= 8
        ? task.meta.rollback.slice(0, 600)
        : 'Revert the pull request and merge the revert; the merge is the deploy, so the revert ships the same way.';
      try {
        const { proposeAction } = await import('@/services/ActionService');
        const res = await proposeAction({
          orgId: ctx.orgId,
          actionId: 'git.merge',
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
          proposal: { confidence: 0.9, rationale: verdict.note, agentSlug: by, suggestedDecision: 'approve', suggestedDecisionReason: `${count}. ${verdict.note}`.slice(0, 160) },
        });
        return `Verdict recorded on task #${task.id}: approve, ${count}, at ${commitSha.slice(0, 12)}. The merge card is filed (run #${res.runId}, ${res.status}); a person merges.`;
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
          evidence: z.string().optional().describe('The link, check or screenshot that settles it. Required for proven.'),
        })), z.string()]).describe('Every acceptance criterion, in contract order, as a list.'),
        findings: z.union([z.array(z.object({
          against: z.enum(['criterion', 'path', 'check']),
          ref: z.string().min(1),
          severity: z.enum(['block', 'fix', 'note']),
          what: z.string().min(1),
          closeBy: z.string().optional(),
        })), z.string()]).optional().describe('Findings keyed to the contract, as a list. block keeps the merge from being proposed.'),
        note: z.string().min(1).max(400).describe('One sentence for the person who merges: what they accept and the one risk to know.'),
        independent_checks: z.union([z.array(z.string()), z.string()]).optional().describe('Checks that ran on trusted CI or that you reproduced, not the worker\'s report.'),
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
