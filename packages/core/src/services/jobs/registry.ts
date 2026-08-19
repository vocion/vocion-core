/**
 * Built-in automation jobs — deterministic server-side tasks an automation can
 * schedule via `do: { job: '<name>' }`, the counterpart to `workflow` (step
 * sequences) and `checkMission` (agent runs). Used for work that is plain code,
 * not an agent or a workflow (e.g. the discovery-call detection sweep).
 */

import { runDiscoverySweepJob } from './discoverySweep';

type BuiltInJob = (orgId: string, input: Record<string, unknown>) => Promise<unknown>;

const JOBS: Record<string, BuiltInJob> = {
  'discovery-sweep': runDiscoverySweepJob,
};

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
