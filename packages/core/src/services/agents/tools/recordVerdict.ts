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
  await db
    .update(businessObjectSchema)
    .set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

export function recordVerdictTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as { pr_url: string; value: typeof VERDICT_VALUES[number]; criteria: VerdictCriterion[]; findings?: VerdictFinding[]; note: string; independent_checks?: string[] };
      const criteria = Array.isArray(args.criteria) ? args.criteria : [];
      const findings = Array.isArray(args.findings) ? args.findings : [];
      const { proven, total, refusal } = judgeVerdict(args.value, criteria, findings);
      if (refusal) {
        return refusal;
      }
      const task = await findTaskByPr(ctx.orgId, args.pr_url);
      if (!task) {
        return `Not recorded: no engineering task in this workspace carries the pull request ${args.pr_url}. Pass the task's prUrl exactly as it is on the record.`;
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
        note: args.note.trim(),
        proven,
        total,
        criteria,
        findings,
        independentChecks: args.independent_checks ?? [],
      };
      await writeTask(ctx.orgId, task.id, { verdict, status: TASK_STATUS_FOR[args.value] });
      ctx.emit({ type: 'tool_progress', tool: 'record_verdict', meta: { taskId: task.id, value: args.value, proven, total } } as never);
      const count = `${proven} of ${total} criteria proven`;
      if (args.value !== 'approve') {
        return `Verdict recorded on task #${task.id}: ${args.value}, ${count}, at ${commitSha.slice(0, 12)}. The task now reads ${TASK_STATUS_FOR[args.value]}; the Work page shows what would settle it.`;
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
      description: 'Record QA\'s verdict on a factory pull request: every acceptance criterion judged proven, unproven or unchecked, with the evidence for each proven one. The server binds it to the PR\'s current head, counts the proven criteria itself, sets the task to accepted, changes_requested or rejected, and on approve files the merge card for a person. This call IS the review; a review that does not end in it did not happen.',
      schema: z.object({
        pr_url: z.string().url().describe('The pull request, e.g. https://github.com/acme/app/pull/12.'),
        value: z.enum(VERDICT_VALUES).describe('approve only when every criterion is proven and nothing blocks; changes when something specific would make it right; reject when the contract itself was wrong.'),
        criteria: z.array(z.object({
          criterion: z.string().min(1).describe('The acceptance criterion, as written on the contract.'),
          status: z.enum(CRITERION_STATUSES),
          evidence: z.string().optional().describe('The link, check or screenshot that settles it. Required for proven.'),
        })).min(1).describe('Every acceptance criterion, in contract order.'),
        findings: z.array(z.object({
          against: z.enum(['criterion', 'path', 'check']),
          ref: z.string().min(1),
          severity: z.enum(['block', 'fix', 'note']),
          what: z.string().min(1),
          closeBy: z.string().optional(),
        })).optional().describe('Findings keyed to the contract. block keeps the merge from being proposed.'),
        note: z.string().min(1).max(400).describe('One sentence for the person who merges: what they accept and the one risk to know.'),
        independent_checks: z.array(z.string()).optional().describe('Checks that ran on trusted CI or that you reproduced, not the worker\'s report.'),
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
