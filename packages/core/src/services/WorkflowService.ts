import type { WorkflowManifest, WorkflowStep } from '@/libs/context/schemas';
import { and, desc, eq } from 'drizzle-orm';
import { getCurrentContextSha } from '@/libs/context';
import { db } from '@/libs/DB';
import { workflowRunSchema, workflowSchema } from '@/models/Schema';
import { executeSkill } from './SkillService';

/**
 * Workflow execution. v1 scope:
 *   - Sequential step execution (no parallel)
 *   - Step types: `skill`, `approve`, `action`
 *   - `action` steps are stubs — they record intent but perform no side effects
 *     (v2 wires concrete actions: gmail.send_email, hubspot.update_deal, etc.)
 *   - No durable scheduler — if the process dies mid-run, the run is stuck at
 *     its last persisted state. Fine for MetaCTO's volume today; Temporal or
 *     a resumer worker arrives with Phase 6 scale-out.
 *   - Approval gating: `approve` steps pause the run; approveWorkflowStep()
 *     resumes from where it left off.
 *
 * Persistence model: one `workflow_run` row per execution. `step_results` is
 * a JSONB map keyed by step name so we can write partial state as we go and
 * the caller can see intermediate outputs without normalized joins.
 */

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval';
type StepResult = {
  status: StepStatus;
  output?: unknown;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  skillRunId?: number;
};

export type StartWorkflowOpts = {
  orgId: string;
  slug: string;
  input?: Record<string, unknown>;
  triggerContext?: Record<string, unknown>;
  invokedBy?: string;
};

export type WorkflowRunSummary = {
  id: number;
  workflowId: number;
  workflowSlug: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStep: number | null;
  pauseReason: string | null;
  stepResults: Record<string, StepResult>;
  error: string | null;
  contextSha: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export async function startWorkflow(opts: StartWorkflowOpts): Promise<WorkflowRunSummary> {
  const workflow = await db.query.workflowSchema.findFirst({
    where: and(eq(workflowSchema.orgId, opts.orgId), eq(workflowSchema.slug, opts.slug)),
  });
  if (!workflow) {
    throw new Error(`workflow "${opts.slug}" not found`);
  }
  if (workflow.status !== 'active') {
    throw new Error(`workflow "${opts.slug}" is ${workflow.status}; cannot start`);
  }

  const contextSha = await getCurrentContextSha(opts.orgId);

  const [run] = await db.insert(workflowRunSchema).values({
    orgId: opts.orgId,
    workflowId: workflow.id,
    input: opts.input ?? {},
    triggerContext: opts.triggerContext ?? {},
    status: 'running',
    currentStep: 0,
    stepResults: {},
    contextSha,
    createdBy: opts.invokedBy ?? 'mcp',
  }).returning();

  return runLoop(run!.id);
}

export async function resumeWorkflow(runId: number, orgId: string): Promise<WorkflowRunSummary> {
  const [run] = await db
    .select()
    .from(workflowRunSchema)
    .where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.orgId, orgId)));
  if (!run) {
    throw new Error(`workflow_run ${runId} not found`);
  }
  if (run.status !== 'paused') {
    throw new Error(`workflow_run ${runId} is ${run.status}; nothing to resume`);
  }

  // Mark the current (approve) step complete and advance the cursor — otherwise
  // the loop would sit on the same approve step and re-pause.
  const stepResults = { ...(run.stepResults as Record<string, StepResult>) };
  const currentIdx = run.currentStep ?? 0;
  const [wf] = await db.select().from(workflowSchema).where(eq(workflowSchema.id, run.workflowId));
  const steps = (wf?.steps ?? []) as unknown as WorkflowStep[];
  const currentStep = steps[currentIdx];
  if (currentStep && currentStep.type === 'approve') {
    stepResults[currentStep.name] = {
      ...stepResults[currentStep.name],
      status: 'completed',
      finishedAt: new Date().toISOString(),
    };
  }

  await db.update(workflowRunSchema)
    .set({
      status: 'running',
      pauseReason: null,
      pausedAt: null,
      stepResults,
      currentStep: currentIdx + 1,
    })
    .where(eq(workflowRunSchema.id, runId));

  return runLoop(runId);
}

export async function cancelWorkflow(runId: number, orgId: string, reason?: string): Promise<WorkflowRunSummary> {
  const [run] = await db
    .update(workflowRunSchema)
    .set({ status: 'cancelled', error: reason ?? null, completedAt: new Date() })
    .where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.orgId, orgId)))
    .returning();
  if (!run) {
    throw new Error(`workflow_run ${runId} not found`);
  }
  return summarize(run);
}

export async function getWorkflowRun(runId: number, orgId: string): Promise<WorkflowRunSummary | null> {
  const [row] = await db
    .select()
    .from(workflowRunSchema)
    .where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.orgId, orgId)));
  return row ? summarize(row) : null;
}

export async function listWorkflowRuns(orgId: string, filters?: { workflowSlug?: string; status?: string; limit?: number }) {
  const conditions = [eq(workflowRunSchema.orgId, orgId)];
  if (filters?.status) {
    conditions.push(eq(workflowRunSchema.status, filters.status));
  }
  if (filters?.workflowSlug) {
    const wf = await db.query.workflowSchema.findFirst({
      where: and(eq(workflowSchema.orgId, orgId), eq(workflowSchema.slug, filters.workflowSlug)),
    });
    if (!wf) {
      return [];
    }
    conditions.push(eq(workflowRunSchema.workflowId, wf.id));
  }
  const rows = await db
    .select()
    .from(workflowRunSchema)
    .where(and(...conditions))
    .orderBy(desc(workflowRunSchema.createdAt))
    .limit(filters?.limit ?? 20);
  return rows.map(summarize);
}

/**
 * Inner execution loop. Picks up at currentStep, runs forward until either:
 *   - steps array exhausted → status = completed
 *   - an approve step is hit → status = paused (caller resumes later)
 *   - a step throws → status = failed
 *
 * Called on initial start AND on resume. Stays a pure function of
 * (run state + workflow definition) so it's safe to call repeatedly.
 * @param runId
 */
async function runLoop(runId: number): Promise<WorkflowRunSummary> {
  const [run] = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.id, runId));
  if (!run) {
    throw new Error(`workflow_run ${runId} not found after start`);
  }
  const [workflow] = await db.select().from(workflowSchema).where(eq(workflowSchema.id, run.workflowId));
  if (!workflow) {
    throw new Error(`workflow ${run.workflowId} missing for run ${runId}`);
  }

  const steps = (workflow.steps ?? []) as unknown as WorkflowStep[];
  const stepResults: Record<string, StepResult> = { ...(run.stepResults as Record<string, StepResult>) };
  const input = (run.input as Record<string, unknown>) ?? {};
  const triggerContext = (run.triggerContext as Record<string, unknown>) ?? {};
  const scope = { input, steps: collectOutputs(stepResults), trigger: triggerContext };

  let cursor = run.currentStep ?? 0;

  while (cursor < steps.length) {
    const step = steps[cursor]!;
    const name = step.name;

    stepResults[name] = {
      ...stepResults[name],
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    await persistState(runId, { stepResults, currentStep: cursor });

    try {
      if (step.type === 'skill') {
        const skillInput = interpolateRecord(step.input as Record<string, unknown>, scope);
        const result = await executeSkill({
          orgId: run.orgId,
          skillSlug: step.skill,
          input: skillInput,
          userId: `workflow:${workflow.slug}:${runId}`,
        });
        const output = tryParseJson(result.output);
        stepResults[name] = {
          status: 'completed',
          output,
          startedAt: stepResults[name]!.startedAt,
          finishedAt: new Date().toISOString(),
          skillRunId: result.runId,
        };
        scope.steps[step.outputAs ?? name] = { output };
      } else if (step.type === 'approve') {
        stepResults[name] = {
          ...stepResults[name],
          status: 'awaiting_approval',
          output: { prompt: step.prompt, reviews: step.reviews },
        };
        await persistState(runId, {
          stepResults,
          currentStep: cursor,
          status: 'paused',
          pauseReason: `awaiting_approval:${name}`,
          pausedAt: new Date(),
        });
        const [paused] = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.id, runId));
        return summarize(paused!);
      } else if (step.type === 'action') {
        // v1 stub: record the intent but take no side effect. Output carries
        // a `__card: 'send-stub'` discriminator so the run-detail page
        // renders it via the Cards SDK (libs/cards) — see
        // libs/cards/firstParty/sendStub.tsx for the renderer.
        const actionInput = interpolateRecord(step.input as Record<string, unknown>, scope);
        const recordedAt = new Date().toISOString();
        const toRaw = actionInput.to_customer ?? actionInput.to;
        const subjectRaw = actionInput.subject;
        const bodyRaw = actionInput.body ?? actionInput.body_from_step;
        const output = {
          __card: 'send-stub' as const,
          stubbed: true as const,
          envelope: {
            to: typeof toRaw === 'string' ? toRaw : undefined,
            subject: typeof subjectRaw === 'string' ? subjectRaw : undefined,
            body: typeof bodyRaw === 'string' ? bodyRaw : JSON.stringify(actionInput, null, 2),
            sent_at: recordedAt,
            action: step.action,
          },
        };
        stepResults[name] = {
          status: 'completed',
          output,
          startedAt: stepResults[name]!.startedAt,
          finishedAt: recordedAt,
        };
        scope.steps[name] = { output };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stepResults[name] = {
        ...stepResults[name],
        status: 'failed',
        error: message,
        finishedAt: new Date().toISOString(),
      };
      await persistState(runId, {
        stepResults,
        currentStep: cursor,
        status: 'failed',
        error: `step "${name}" failed: ${message}`,
        completedAt: new Date(),
      });
      const [failed] = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.id, runId));
      return summarize(failed!);
    }

    cursor += 1;
  }

  await persistState(runId, {
    stepResults,
    currentStep: cursor,
    status: 'completed',
    completedAt: new Date(),
  });
  const [done] = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.id, runId));
  return summarize(done!);
}

type PersistPatch = {
  stepResults: Record<string, StepResult>;
  currentStep: number;
  status?: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  pauseReason?: string | null;
  pausedAt?: Date | null;
  error?: string | null;
  completedAt?: Date;
};

async function persistState(runId: number, patch: PersistPatch): Promise<void> {
  const update: Record<string, unknown> = {
    stepResults: patch.stepResults,
    currentStep: patch.currentStep,
  };
  if (patch.status !== undefined) {
    update.status = patch.status;
  }
  if (patch.pauseReason !== undefined) {
    update.pauseReason = patch.pauseReason;
  }
  if (patch.pausedAt !== undefined) {
    update.pausedAt = patch.pausedAt;
  }
  if (patch.error !== undefined) {
    update.error = patch.error;
  }
  if (patch.completedAt !== undefined) {
    update.completedAt = patch.completedAt;
  }
  await db.update(workflowRunSchema).set(update).where(eq(workflowRunSchema.id, runId));
}

function collectOutputs(results: Record<string, StepResult>): Record<string, { output: unknown }> {
  const out: Record<string, { output: unknown }> = {};
  for (const [name, r] of Object.entries(results)) {
    if (r.status === 'completed' && r.output !== undefined) {
      out[name] = { output: r.output };
    }
  }
  return out;
}

/**
 * Interpolate `{{expr}}` references in every string leaf of a record.
 * Supports dotted paths into `input`, `steps.<name>.output`, `trigger`, or
 * `steps.<name>.output.<field>`. Non-string leaves pass through unchanged.
 * @param value
 * @param scope
 */
function interpolateRecord(value: Record<string, unknown>, scope: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = interpolateValue(v, scope);
  }
  return out;
}

function interpolateValue(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, scope);
  }
  if (Array.isArray(value)) {
    return value.map(v => interpolateValue(v, scope));
  }
  if (value && typeof value === 'object') {
    return interpolateRecord(value as Record<string, unknown>, scope);
  }
  return value;
}

function interpolateString(template: string, scope: Record<string, unknown>): unknown {
  // Whole-string match returns the referenced value verbatim (keeps types)
  // — so `{{steps.summary.output}}` returns an object, not its string repr.
  const wholeMatch = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(template);
  if (wholeMatch) {
    return resolvePath(scope, wholeMatch[1]!);
  }
  return template.replaceAll(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = resolvePath(scope, path as string);
    return v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  });
}

function resolvePath(scope: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = scope;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function summarize(row: typeof workflowRunSchema.$inferSelect): WorkflowRunSummary {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowSlug: '', // filled by caller if needed
    status: row.status as WorkflowRunSummary['status'],
    currentStep: row.currentStep,
    pauseReason: row.pauseReason,
    stepResults: (row.stepResults ?? {}) as Record<string, StepResult>,
    error: row.error,
    contextSha: row.contextSha,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export async function listWorkflows(orgId: string) {
  return db.select().from(workflowSchema).where(eq(workflowSchema.orgId, orgId));
}

/**
 * Submit (or update) post-hoc feedback on a workflow run. Works on any
 * status — the feedback columns are independent of lifecycle state.
 * @param opts
 * @param opts.orgId
 * @param opts.runId
 * @param opts.submittedBy
 * @param opts.rating
 * @param opts.note
 */
export async function submitWorkflowRunFeedback(opts: { orgId: string; runId: number; submittedBy: string; rating?: 'up' | 'down' | null; note?: string | null }): Promise<typeof workflowRunSchema.$inferSelect | null> {
  const [updated] = await db
    .update(workflowRunSchema)
    .set({
      rating: opts.rating ?? null,
      feedbackNote: opts.note ?? null,
      feedbackBy: opts.submittedBy,
      feedbackAt: new Date(),
    })
    .where(and(eq(workflowRunSchema.id, opts.runId), eq(workflowRunSchema.orgId, opts.orgId)))
    .returning();
  return updated ?? null;
}

export async function getWorkflow(orgId: string, slug: string): Promise<WorkflowManifest | null> {
  const [row] = await db.select().from(workflowSchema).where(and(eq(workflowSchema.orgId, orgId), eq(workflowSchema.slug, slug)));
  if (!row) {
    return null;
  }
  // Return the manifest-shaped view. Steps/trigger were stored as JSONB exactly as authored.
  return {
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    status: (row.status ?? 'active') as WorkflowManifest['status'],
    version: row.version ?? 1,
    trigger: row.trigger as WorkflowManifest['trigger'],
    steps: row.steps as unknown as WorkflowManifest['steps'],
    inputSchema: row.inputSchema ?? undefined,
  };
}
