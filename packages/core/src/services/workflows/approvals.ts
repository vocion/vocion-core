/**
 * A WORKFLOW'S `approve` STEP IS A DECISION (`ask`), decided the way every
 * Decision is: on its card, by a chip, or in a person's own words
 * (`decide_ask`, #1504). The run waits on it; the answer moves the run.
 *
 * - Pausing at the step files one `approval` ask, `source_ref
 *   workflow-run:<runId>:<step>`, carrying the step's prompt and what the step
 *   `reviews` (an agent step's result, a repeat group's open findings).
 * - Approving it resumes the run; rejecting or skipping it stops the run with
 *   the reason (`onWorkflowAskSettled`, from `AskService.settleWaitersOn`).
 * - A run resumed or cancelled anywhere else (the review queue, the API)
 *   closes its open Decision, so nothing is left to answer twice.
 */
import type { Ask } from '@/services/AskService';
import { and, eq, like } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { askSchema } from '@/models/Schema';

const PREFIX = 'workflow-run';

/**
 * The Decision's `source_ref` for one step of one run.
 * @param runId - The workflow run.
 * @param step - The approve step's name.
 */
export function workflowAskRef(runId: number, step: string): string {
  return `${PREFIX}:${runId}:${step}`;
}

/**
 * The run and step a Decision belongs to, or null when it is not a workflow's.
 * @param ref - `ask.source_ref`.
 */
export function parseWorkflowAskRef(ref: string | null | undefined): { runId: number; step: string } | null {
  const m = /^workflow-run:(\d+):([a-z][\w-]*)$/.exec(ref ?? '');
  return m ? { runId: Number(m[1]), step: m[2]! } : null;
}

/**
 * A step's output as a person reads it on a card: text as it is, a list as
 * bullets, an object as one line per field. Long values are cut.
 * @param value - The output.
 * @param depth - How deep this call is (nested values stay on one line).
 */
export function outputMarkdown(value: unknown, depth = 0): string {
  const cut = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return cut(value, 1500);
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (depth > 0) {
    return cut(Array.isArray(value) && value.every(v => typeof v !== 'object') ? value.join(', ') : JSON.stringify(value), 300);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(v => `- ${outputMarkdown(v, 1)}`).join('\n');
  }
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 20)
    .map(([k, v]) => Array.isArray(v) && v.length > 0 && depth === 0
      ? `**${k}:**\n${v.slice(0, 20).map(x => `- ${outputMarkdown(x, 1)}`).join('\n')}`
      : `**${k}:** ${outputMarkdown(v, 1) || '—'}`)
    .join('\n');
}

/**
 * File (or refresh) the Decision an approve step waits on. Idempotent on the
 * step: a replayed segment updates the same row.
 * @param opts - The run and the step.
 * @param opts.orgId - The workspace.
 * @param opts.runId - The workflow run.
 * @param opts.workflow - The workflow.
 * @param opts.workflow.slug - Its slug.
 * @param opts.workflow.name - Its name.
 * @param opts.workflow.agent - Its owning agent, who asks.
 * @param opts.runLabel - The run's label.
 * @param opts.step - The step's name.
 * @param opts.label - The step's label.
 * @param opts.prompt - The step's prompt, interpolated.
 * @param opts.reviewed - What it reviews: the step's label and output.
 */
export async function fileApprovalAsk(opts: {
  orgId: string;
  runId: number;
  workflow: { slug: string; name: string; agent?: string | null };
  runLabel?: string | null;
  step: string;
  label: string;
  prompt: string;
  reviewed?: { label: string; output: unknown } | null;
}): Promise<number> {
  const { upsertAsk } = await import('@/services/AskService');
  const sourceRef = workflowAskRef(opts.runId, opts.step);
  const named = opts.runLabel?.trim() || `${opts.workflow.name} #${opts.runId}`;
  let title = `${opts.label} · ${named}`;
  // An open Decision of the same kind and title IS that Decision to the ask
  // store, so two runs that share a label would share one answer. The run's
  // number keeps them apart.
  const [same] = await db
    .select({ sourceRef: askSchema.sourceRef })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, opts.orgId), eq(askSchema.status, 'open'), eq(askSchema.kind, 'approval'), eq(askSchema.title, title)))
    .limit(1);
  if (same && same.sourceRef !== sourceRef) {
    title = `${title} (#${opts.runId})`;
  }
  const reviewed = opts.reviewed ? outputMarkdown(opts.reviewed.output) : '';
  const runHref = `/dashboard/workflows/${encodeURIComponent(opts.workflow.slug)}/runs/${opts.runId}`;
  const { ask } = await upsertAsk({
    orgId: opts.orgId,
    createdBy: opts.workflow.agent ? `agent:${opts.workflow.agent}` : `workflow:${opts.workflow.slug}`,
    ask: {
      kind: 'approval',
      title,
      body: opts.prompt,
      sourceRef,
      agentSlug: opts.workflow.agent ?? null,
      contextUrl: runHref,
      contextMd: [
        reviewed ? `**${opts.reviewed!.label}**\n\n${reviewed}` : null,
        `[The run, step by step](${runHref})`,
      ].filter(Boolean).join('\n\n'),
      outcomes: { onApprove: 'The run goes on to its next step.', onReject: 'The run stops here.' },
    },
  });
  return ask.id;
}

/**
 * Close a run's open Decisions: it was resumed or stopped somewhere else.
 * @param orgId - The workspace.
 * @param runId - The workflow run.
 * @param note - What happened, for the card.
 */
export async function closeWorkflowAsks(orgId: string, runId: number, note: string): Promise<void> {
  const open = await db
    .select({ id: askSchema.id })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, `${PREFIX}:${runId}:%`)));
  if (open.length === 0) {
    return;
  }
  const { supersedeAsk } = await import('@/services/AskService');
  for (const a of open) {
    await supersedeAsk(orgId, a.id, note);
  }
}

/**
 * A workflow's Decision was answered: move the run. Approved (or marked done)
 * resumes it; rejected or skipped stops it with the reason. Anything else —
 * superseded, or a run that already moved — is left alone.
 * @param row - The ask as written.
 */
export async function onWorkflowAskSettled(row: Ask): Promise<void> {
  const ref = parseWorkflowAskRef(row.sourceRef);
  if (!ref) {
    return;
  }
  const { cancelWorkflow, getWorkflowRun, resumeWorkflow, WorkflowRunNotResumableError } = await import('@/services/WorkflowService');
  const run = await getWorkflowRun(ref.runId, row.orgId);
  if (!run || run.status !== 'paused' || run.pauseReason !== `awaiting_approval:${ref.step}`) {
    return;
  }
  const by = row.decidedBy ?? 'unknown';
  try {
    if (row.status === 'approved' || row.status === 'done') {
      await resumeWorkflow(ref.runId, row.orgId, { approval: { by, note: row.decisionNote ?? null, via: row.decidedVia ?? null, askId: row.id } }, { wait: false });
    } else if (row.status === 'rejected' || row.status === 'skipped') {
      const why = row.status === 'skipped' ? 'skipped the sign-off' : 'rejected it';
      await cancelWorkflow(ref.runId, row.orgId, `${by} ${why} at "${ref.step}"${row.decisionNote ? `: ${row.decisionNote}` : ''}`);
    }
  } catch (err) {
    // Another path moved the run between the read and the write: it moved.
    if (!(err instanceof WorkflowRunNotResumableError)) {
      throw err;
    }
  }
}
