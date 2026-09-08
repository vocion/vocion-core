/**
 * Which machinery runs an agent turn, and what to call it.
 *
 * There are three answers, and they used to be spelled in a way that hid the
 * distinction that matters. The old names were `local`, `runtime` and
 * `agentcore` — which read as though only the third involved AWS AgentCore,
 * when in fact `runtime` is the AgentCore path we actually deploy. The three
 * real answers are:
 *
 *   1. **our harness, no AgentCore** — the deepagents loop in this process
 *   2. **our harness, on AgentCore** — the same loop, in our container, hosted
 *      on AgentCore Runtime
 *   3. **AWS's managed harness** — AWS owns the loop; our agent is reduced to
 *      configuration and one tool
 *
 * Names now say which of those you get. `agentcore-container` and
 * `aws-managed-harness` both involve AgentCore, and the name tells you whose
 * loop you are running rather than whose cloud it sits in.
 *
 * The old spellings are still accepted everywhere — in workspace YAML, in
 * `VOCION_AGENT_PROVIDER`, and in `harness_config` rows written before the
 * rename. Parent projects hold workspace files we do not deploy (Veerio's
 * `event-ingestion-lead` is authored as `provider: agentcore`), so dropping
 * the old names would break an apply in a repo this one cannot see.
 *
 * Note that `bedrock` is NOT one of these. It is a `modelProvider` — which
 * vendor answers — and is a different axis entirely.
 */

import { z } from 'zod';

/** The canonical name for each place an agent turn can run. */
export type HarnessTarget = 'in-process' | 'agentcore-container' | 'aws-managed-harness';

/**
 * The pre-rename spellings, and what each one meant.
 *
 * Kept as data rather than a chain of `if`s so the mapping is readable as a
 * table and so `harnessTargetNames` can list both spellings for a schema.
 */
const LEGACY_NAMES: Record<string, HarnessTarget> = {
  local: 'in-process',
  runtime: 'agentcore-container',
  agentcore: 'aws-managed-harness',
};

const CANONICAL_NAMES: HarnessTarget[] = ['in-process', 'agentcore-container', 'aws-managed-harness'];

/** Every accepted spelling, canonical first. For schema enums and error text. */
export function harnessTargetNames(): string[] {
  return [...CANONICAL_NAMES, ...Object.keys(LEGACY_NAMES)];
}

/**
 * The canonical target for whatever an author, an env var, or an old database
 * row called it.
 *
 * Returns undefined for absent or unrecognised input rather than guessing a
 * default. "Nobody said" has to stay distinguishable from "somebody said
 * in-process", because the Bedrock default in `AgentService` only applies to
 * the first case.
 * @param value - Whatever was authored or stored: a canonical name, a legacy
 * name, or nothing at all.
 */
export function normalizeHarnessTarget(value: string | null | undefined): HarnessTarget | undefined {
  if (!value) {
    return undefined;
  }
  if (CANONICAL_NAMES.includes(value as HarnessTarget)) {
    return value as HarnessTarget;
  }
  return LEGACY_NAMES[value];
}

/**
 * Zod schema accepting any spelling and yielding the canonical one.
 *
 * The enum lists legacy names too, so a workspace file written before the
 * rename still validates; the transform is what makes everything downstream
 * see one name per target.
 */
export const harnessTargetSchema = z
  .enum(harnessTargetNames() as [string, ...string[]])
  .transform(value => normalizeHarnessTarget(value) as HarnessTarget);
