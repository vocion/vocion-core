/**
 * The checks on a workflow's steps that need the rest of the workspace or a
 * compiler, run at `workspace:check` (`loader.ts`). The shape of each step is
 * the schema's (`WorkflowManifestSchema`); this is what a shape cannot say:
 *
 * - an `agent` step names an agent this workspace has — a dangling one would
 *   fail the run at that step, after the work before it was spent;
 * - an `agent` step's `output` is a JSON Schema the validator can compile, so
 *   a typo in it fails here rather than failing every run's result.
 */
import Ajv from 'ajv';

type CheckedStep = { name: string; type: string; agent?: string; output?: Record<string, unknown>; steps?: CheckedStep[] };

type CheckedWorkflow = { slug: string; sourceFile: string; steps: CheckedStep[] };

/**
 * Throw, naming every problem, when a workflow's agent steps do not resolve.
 * @param agents - The workspace's agents.
 * @param workflows - Its workflows.
 */
export function assertWorkflowSteps(agents: Array<{ slug: string }>, workflows: CheckedWorkflow[]): void {
  const agentSlugs = new Set(agents.map(a => a.slug));
  const ajv = new Ajv({ strict: false, allErrors: true });
  const errors: string[] = [];
  const visit = (wf: CheckedWorkflow, step: CheckedStep) => {
    if (step.type === 'agent') {
      if (step.agent && !agentSlugs.has(step.agent)) {
        errors.push(`${wf.sourceFile}: workflow "${wf.slug}" step "${step.name}" asks agent "${step.agent}", and no agent in this workspace has that slug`);
      }
      if (step.output) {
        try {
          ajv.compile(step.output);
        } catch (err) {
          errors.push(`${wf.sourceFile}: workflow "${wf.slug}" step "${step.name}" has an output schema that does not compile: ${(err as Error).message}`);
        }
      }
    }
    for (const inner of step.steps ?? []) {
      visit(wf, inner);
    }
  };
  for (const wf of workflows) {
    for (const step of wf.steps) {
      visit(wf, step);
    }
  }
  if (errors.length > 0) {
    throw new Error(`workflow steps invalid:\n  ${errors.join('\n  ')}`);
  }
}
