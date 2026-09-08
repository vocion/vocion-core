/**
 * Which machinery runs an agent turn, and what to call it.
 *
 * Three targets:
 *
 * | Name | Whose loop | Where it runs |
 * |---|---|---|
 * | `in-process` | ours (deepagents) | this process |
 * | `agentcore-container` | ours (deepagents), same code | our container, hosted on AgentCore Runtime |
 * | `aws-managed-harness` | AWS's | AWS; our agent is reduced to configuration and one tool |
 *
 * The old names were `local`, `runtime` and `agentcore`. Those read as though
 * only the third involved AWS AgentCore, when `runtime` is the AgentCore path
 * we actually deploy. Each new name says whose loop you get.
 *
 * Old spellings are still accepted everywhere: workspace YAML,
 * `VOCION_AGENT_PROVIDER`, and `harness_config` rows written before the
 * rename. Parent projects hold workspace files we do not deploy — Veerio's
 * `event-ingestion-lead` is authored as `provider: agentcore` — so dropping
 * the old names would break an apply in a repo this one cannot see.
 *
 * `bedrock` is not one of these. It is a `modelProvider`, meaning which
 * vendor answers, which is a different axis. Full picture:
 * `docs/agent-execution.md`.
 */
import { z } from 'zod';

/** The canonical name for each place an agent turn can run. */
export type HarnessTarget = 'in-process' | 'agentcore-container' | 'aws-managed-harness';

/**
 * The pre-rename spellings, and what each one meant.
 *
 * Data rather than a chain of `if`s, so the mapping reads as a table and
 * `harnessTargetNames` can list both spellings for a schema.
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
 * Absent or unrecognised input returns undefined instead of a guessed
 * default. "Nobody said" must stay distinguishable from "somebody said
 * in-process": the Bedrock default in `AgentService` applies only to the
 * first.
 * @param value - What was authored or stored: a canonical name, a legacy
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
 * The enum lists the legacy names too, so a workspace file written before the
 * rename still validates. The transform is what leaves everything downstream
 * with one name per target.
 */
export const harnessTargetSchema = z
  .enum(harnessTargetNames() as [string, ...string[]])
  .transform(value => normalizeHarnessTarget(value) as HarnessTarget);
