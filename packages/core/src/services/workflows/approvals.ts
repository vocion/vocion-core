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
import type { DecisionFact } from '@/libs/decisions/decision';
import type { Ask } from '@/services/AskService';
import { and, eq, like } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { factsTable } from '@/libs/decisions/decision';
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
    // An artifact a step made (`artifact:<id>`) opens from the card.
    const ref = /^artifact:(\d+)$/.exec(value.trim());
    return ref ? `[Open](/dashboard/artifacts/${ref[1]})` : cut(value, 1500);
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (depth > 0) {
    // One item of a list: its fields on one line, each artifact it names a link.
    if (!Array.isArray(value)) {
      return Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? outputMarkdown(v.length > 300 ? cut(v, 300) : v) : cut(JSON.stringify(v) ?? '', 200)}`)
        .join(' · ');
    }
    return cut(value.every(v => typeof v !== 'object') ? value.join(', ') : JSON.stringify(value), 300);
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

const ARTIFACT_REF = /^artifact:(\d+)$/;

/**
 * What a step made, as the facts a person approves it on, when it made a list
 * of items: one row per item, named by its first text field, the rest of its
 * text on the row, and the row opening the first artifact the item names.
 * Null when the output is not a list of items. Pure.
 * @param output - The reviewed step's output.
 */
export function reviewedFacts(output: unknown): DecisionFact[] | null {
  const lists = Array.isArray(output)
    ? [output]
    : output && typeof output === 'object' ? Object.values(output as Record<string, unknown>).filter(Array.isArray) : [];
  const items = lists.length === 1 ? (lists[0] as unknown[]) : [];
  if (items.length === 0 || !items.every(i => i && typeof i === 'object' && !Array.isArray(i))) {
    return null;
  }
  const facts = (items as Array<Record<string, unknown>>).slice(0, 20).map((item) => {
    const entries = Object.entries(item).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v).trim()] as const).filter(([, v]) => v);
    const artifact = entries.map(([, v]) => ARTIFACT_REF.exec(v)).find(Boolean);
    const text = entries.filter(([, v]) => !ARTIFACT_REF.test(v) && !/^https?:\/\//.test(v));
    const [first, ...rest] = text;
    if (!first) {
      return null;
    }
    // A bare number reads with its field's name ("provider count 4"); text reads as it is.
    const value = rest.map(([k, v]) => (/^\d+(?:\.\d+)?$/.test(v) ? `${k.replace(/[_-]+/g, ' ')} ${v}` : v)).join(' · ') || '—';
    return { label: first[1], value, ...(artifact ? { href: `/dashboard/artifacts/${artifact[1]}` } : {}) };
  });
  return facts.every(Boolean) ? facts as DecisionFact[] : null;
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
 * @param opts.conversationId - The conversation the run was started from: the Decision docks there.
 * @param opts.ownerUserId - The person who started the run: the Decision waits on them.
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
  conversationId?: number | null;
  ownerUserId?: string | null;
}): Promise<number> {
  const { upsertAsk } = await import('@/services/AskService');
  const sourceRef = workflowAskRef(opts.runId, opts.step);
  const named = opts.runLabel?.trim() || `${opts.workflow.name} #${opts.runId}`;
  // Asked as its author wrote it: the step's prompt is the question; the step and run are named under it.
  const question = opts.prompt.trim() || opts.label;
  let title = question;
  // An open Decision of the same kind and title IS that Decision to the ask
  // store, so two runs that ask the same thing would share one answer. The
  // run's number keeps them apart.
  const [same] = await db
    .select({ sourceRef: askSchema.sourceRef })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, opts.orgId), eq(askSchema.status, 'open'), eq(askSchema.kind, 'approval'), eq(askSchema.title, title)))
    .limit(1);
  if (same && same.sourceRef !== sourceRef) {
    title = `#${opts.runId} · ${question}`;
  }
  const facts = opts.reviewed ? reviewedFacts(opts.reviewed.output) : null;
  const reviewed = opts.reviewed && !facts ? outputMarkdown(opts.reviewed.output) : '';
  const runHref = `/dashboard/workflows/${encodeURIComponent(opts.workflow.slug)}/runs/${opts.runId}`;
  const { ask } = await upsertAsk({
    orgId: opts.orgId,
    createdBy: opts.workflow.agent ? `agent:${opts.workflow.agent}` : `workflow:${opts.workflow.slug}`,
    ask: {
      kind: 'approval',
      title,
      body: `${opts.label} · ${named}`,
      sourceRef,
      agentSlug: opts.workflow.agent ?? null,
      contextUrl: runHref,
      // Facts are drawn as a list on the card; the run, step by step, is its Details.
      contextMd: facts
        ? factsTable(facts.map(f => ({ label: f.label, value: f.href ? `[${f.value}](${f.href})` : f.value })), opts.reviewed!.label)
        : [
            reviewed ? `**${opts.reviewed!.label}**\n\n${reviewed}` : null,
            `[The run, step by step](${runHref})`,
          ].filter(Boolean).join('\n\n'),
      outcomes: { onApprove: 'The run goes on to its next step.', onReject: 'The run stops here.' },
      ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
      ...(opts.ownerUserId ? { ownerUserId: opts.ownerUserId } : {}),
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
