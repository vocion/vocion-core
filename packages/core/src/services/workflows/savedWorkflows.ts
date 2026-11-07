/**
 * THE SAVED WORKFLOWS AN AGENT CAN START, described by what they do.
 *
 * One description serves three readers: the consent judge, which reads a
 * workflow run as its steps — the agent work each declares, the automations
 * its `routine.run` steps run and what they change, and where it waits for a
 * person (`libs/actions/workflow-run.ts`, through `consentDecision`); the
 * agent, which sees the workspace's workflows in its prompt; and the router,
 * which sees the workflows a seat starts. Like saved automations
 * (`services/routines/savedAutomations.ts`): short, active ones only, stable
 * so the prompt cache holds.
 */

import type { RoutineView } from '@/libs/routines/types';
import type { WorkflowStep } from '@/libs/workspace/schemas';
import { automationChanges } from '@/libs/routines/describe';

/** A saved workflow, as the judge, an agent and the router read it. */
export type SavedWorkflow = {
  slug: string;
  name: string;
  description: string;
  /** The agent that owns it, when it names one. */
  owner: string | null;
  /** What it takes when started, by name. */
  inputs: string[];
  /** Its steps, a line each, in order. */
  steps: string[];
};

/** The grant that puts `workflow_start` on an agent's belt before its workspace has a workflow, and unowned workflows on its seat. */
export const WORKFLOWS_GRANT = 'workflows';

/** How many workflows an agent's prompt names. */
export const WORKFLOWS_IN_PROMPT = 8;

type RoutineLookup = (ref: string) => RoutineView | undefined;

function clip(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * One step, in a line: what it does, by its kind. Pure.
 * @param step - The step as authored.
 * @param routine - The automation a `routine.run` step names, looked up by its slug or name.
 */
export function describeStep(step: WorkflowStep | { type: string; name: string; label?: string; [k: string]: unknown }, routine: RoutineLookup = () => undefined): string {
  const s = step as Record<string, unknown> & { type: string; name: string; label?: string };
  const label = clip(s.label ?? s.name, 80);
  switch (s.type) {
    case 'agent':
      return `${label} — ${String(s.agent)} does: ${clip(String(s.task ?? ''), 220)}`;
    case 'approve':
      return `${label} — waits for a person to approve: ${clip(String(s.prompt ?? ''), 160)}`;
    case 'ask':
      return `${label} — waits for a person to answer: ${clip(String(s.prompt ?? ''), 160)}`;
    case 'sync':
      return `${label} — refreshes ${(s.sources as string[] | undefined ?? []).join(', ')}`;
    case 'repeat':
      return `${label} — repeats up to ${String(s.max)} rounds: ${(s.steps as Array<{ type: string; name: string }> | undefined ?? []).map(x => describeStep(x, routine)).join('; ')}`;
    case 'action': {
      const input = (s.input ?? {}) as Record<string, unknown>;
      if (s.action === 'routine.run') {
        const r = typeof input.routine === 'string' ? routine(input.routine) : undefined;
        const name = r?.name ?? String(input.routine ?? 'an automation');
        const changes = r ? automationChanges(r) : '';
        return `${label} — runs the saved automation "${name}" for each row${input.wait === true ? ', and waits for every row' : ''}${changes ? `; ${clip(changes, 260)}` : ''}`;
      }
      if (s.action === 'workflow.start') {
        return `${label} — starts the workflow "${String(input.workflow ?? '')}" once for each item`;
      }
      return `${label} — ${String(s.action)}`;
    }
    default:
      return label;
  }
}

/**
 * A workflow row as it is read. Pure.
 * @param row - The workflow.
 * @param row.slug - Its slug.
 * @param row.name - Its name.
 * @param row.description - What it is for.
 * @param row.ownerAgentSlug - The agent that owns it.
 * @param row.steps - Its steps, as authored.
 * @param row.inputSchema - What it takes.
 * @param routine - The automations its `routine.run` steps name.
 */
export function savedWorkflow(row: { slug: string; name: string; description?: string | null; ownerAgentSlug?: string | null; steps: unknown; inputSchema?: Record<string, unknown> | null }, routine: RoutineLookup = () => undefined): SavedWorkflow {
  const steps = (Array.isArray(row.steps) ? row.steps : []) as WorkflowStep[];
  const props = row.inputSchema && typeof row.inputSchema.properties === 'object' && row.inputSchema.properties ? Object.keys(row.inputSchema.properties as object) : [];
  return {
    slug: row.slug,
    name: row.name,
    description: clip(row.description ?? '', 300),
    owner: row.ownerAgentSlug ?? null,
    inputs: props,
    steps: steps.map(st => describeStep(st, routine)),
  };
}

/**
 * The automations a workspace's workflows name, looked up by slug or name.
 * @param routines - The workspace's automations.
 */
export function routineLookup(routines: readonly RoutineView[]): RoutineLookup {
  return (ref) => {
    const want = ref.trim().toLowerCase();
    return routines.find(r => r.slug === want) ?? routines.find(r => r.name.toLowerCase() === want);
  };
}

/**
 * The workspace's active workflows. Never throws: empty when they cannot be read.
 * @param orgId - The workspace.
 */
export async function savedWorkflows(orgId: string): Promise<SavedWorkflow[]> {
  try {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { workflowSchema } = await import('@/models/Schema');
    const rows = await db.select().from(workflowSchema).where(and(eq(workflowSchema.orgId, orgId), eq(workflowSchema.status, 'active')));
    if (rows.length === 0) {
      return [];
    }
    const named = rows.some(r => ((r.steps ?? []) as unknown as Array<{ action?: string }>).some(st => st.action === 'routine.run'));
    const routines = named ? await (await import('@/services/routines/routineReads')).listRoutines(orgId) : [];
    const lookup = routineLookup(routines);
    return rows.sort((a, b) => a.slug.localeCompare(b.slug)).map(r => savedWorkflow({ ...r, inputSchema: r.inputSchema as Record<string, unknown> | null }, lookup));
  } catch (err) {
    console.warn('saved workflows read failed', { orgId, message: (err as Error).message });
    return [];
  }
}

/**
 * One saved workflow by slug or name, among the workspace's.
 * @param workflows - The workspace's workflows.
 * @param ref - A slug or a name.
 */
export function findSavedWorkflow(workflows: readonly SavedWorkflow[], ref: string): SavedWorkflow | undefined {
  const want = ref.trim().toLowerCase();
  return workflows.find(w => w.slug === want) ?? workflows.find(w => w.name.toLowerCase() === want);
}

/**
 * The block an agent that can start workflows reads in its prompt. Null when
 * there are none. Pure.
 * @param workflows - The active workflows.
 */
export function savedWorkflowsNote(workflows: readonly SavedWorkflow[]): string | null {
  if (workflows.length === 0) {
    return null;
  }
  const shown = workflows.slice(0, WORKFLOWS_IN_PROMPT);
  return [
    'SAVED WORKFLOWS you can start with workflow_start, each a fixed procedure from start to finish:',
    ...shown.map(w => [
      `- ${w.slug} ("${w.name}")${w.description ? `: ${w.description}` : ''}`,
      w.inputs.length > 0 ? `  Takes: ${w.inputs.join(', ')}.` : '',
      `  Steps: ${w.steps.map((st, i) => `${i + 1}. ${clip(st, 140)}`).join(' ')}`,
    ].filter(Boolean).join('\n')),
    'When the person asks for the whole of what one of these does, start it rather than doing its steps one by one; it reports in this conversation as it goes.',
  ].join('\n');
}

/**
 * The workflows a seat starts, as the router reads them: name and purpose. Pure.
 * @param workflows - The workflows.
 */
export function workflowsForRouter(workflows: ReadonlyArray<Pick<SavedWorkflow, 'name' | 'description'>>): string[] {
  return workflows.slice(0, WORKFLOWS_IN_PROMPT).map(w => `"${w.name}"${w.description ? ` (${clip(w.description, 140)})` : ''}`);
}
