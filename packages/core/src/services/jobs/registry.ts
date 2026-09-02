/**
 * Built-in automation jobs — deterministic server-side tasks an automation can
 * schedule via `do: { job: '<name>' }`, the counterpart to `workflow` (step
 * sequences) and `checkMission` (agent runs). Used for work that is plain code,
 * not an agent or a workflow.
 *
 * Currently empty: discovery-call detection, the one job that lived here,
 * became agent-driven (an hourly `checkMission` automation carrying an
 * execution prompt; the tools are `services/agents/tools/discovery.ts`).
 * The registry stays because the `do: job` seam is still part of the
 * automation contract.
 */

type BuiltInJob = (orgId: string, input: Record<string, unknown>) => Promise<unknown>;

const JOBS: Record<string, BuiltInJob> = {};

export function isBuiltInJob(name: string): boolean {
  return name in JOBS;
}

export async function runBuiltInJob(name: string, orgId: string, input: Record<string, unknown>): Promise<unknown> {
  const fn = JOBS[name];
  if (!fn) {
    throw new Error(`unknown automation job: ${name}`);
  }
  return fn(orgId, input);
}
