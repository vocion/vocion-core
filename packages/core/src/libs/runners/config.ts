/**
 * THE INSTALLATION'S RUNNERS (backlog 052). Where engineering runs are built is installation
 * config, not workspace config (Chris, 2026-09-30: "if anyone creates a new Workspace there, it
 * inherits our infra and scalability"). An installation declares its targets once; every
 * workspace on it builds on them with nothing to set up. A workspace naming its own target, for a
 * team that must build inside its own account, is the exception and is not built yet.
 *
 * A target is only how a runner container starts (packages/runner is the one image):
 *
 * - `on-box` — the `vocion-runner` service in the box's compose. The backup: it claims a run only
 *   once it has waited `claimAfterSeconds` (the runner's `RUNNER_CLAIM_AFTER`, default 120)
 *   unclaimed, and 0 makes it primary where no cloud target exists.
 * - `aws-fargate` — a task in the installation's own AWS account, started at dispatch (push) with
 *   the minute poll as the fallback. Names only, never secrets: the cluster, the task definition,
 *   the subnets and security groups, provisioned by the instance's own IaC.
 *
 * Read from `VOCION_RUNNERS` (JSON) or the file `VOCION_RUNNERS_FILE` names. Neither set: the
 * installation has the on-box target alone, which is what a box with the compose service runs.
 * A malformed declaration is said once in the log and read as that same default, so a typo never
 * stops the factory.
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';

const NameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'a target name is lowercase letters, digits and dashes');

const OnBoxSchema = z.object({
  name: NameSchema,
  kind: z.literal('on-box'),
  /** Wait this long before claiming a queued run; overrides what the runner asks for. */
  claimAfterSeconds: z.number().int().min(0).max(3600).optional(),
});

const FargateSchema = z.object({
  name: NameSchema,
  kind: z.literal('aws-fargate'),
  region: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/, 'an AWS region, e.g. us-east-1'),
  cluster: z.string().min(1),
  /** The task definition family (or family:revision) for a run with no services. */
  taskDefinition: z.string().min(1),
  /** The task definition for a run whose contract names a database service, when it differs. */
  taskDefinitionWithDb: z.string().min(1).optional(),
  subnets: z.array(z.string().min(1)).min(1),
  securityGroups: z.array(z.string().min(1)).min(1),
  assignPublicIp: z.boolean().default(true),
  /** The runner's container name in the task definition, for the per-run overrides. */
  containerName: z.string().min(1).default('runner'),
  /** FARGATE or FARGATE_SPOT; the cluster's default strategy when omitted. */
  capacityProvider: z.enum(['FARGATE', 'FARGATE_SPOT']).optional(),
  claimAfterSeconds: z.number().int().min(0).max(3600).optional(),
});

export const RunnerTargetSchema = z.discriminatedUnion('kind', [OnBoxSchema, FargateSchema]);
export type RunnerTarget = z.infer<typeof RunnerTargetSchema>;
export type FargateTarget = z.infer<typeof FargateSchema>;

const RunnersSchema = z.object({ targets: z.array(RunnerTargetSchema).min(1) })
  .refine(r => new Set(r.targets.map(t => t.name)).size === r.targets.length, { message: 'target names are unique' });

/** What an installation has when it declares nothing: the box's own backup runner. */
export const DEFAULT_TARGETS: readonly RunnerTarget[] = [{ name: 'on-box', kind: 'on-box' }];

export type RunnersConfig = { targets: RunnerTarget[]; source: 'env' | 'file' | 'default'; problem: string | null };

/**
 * Parse a declaration. Pure, so a test hands it text.
 * @param raw - The JSON text.
 * @param source - Where it came from.
 */
export function parseRunners(raw: string, source: 'env' | 'file'): RunnersConfig {
  try {
    const parsed = RunnersSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return { targets: parsed.data.targets, source, problem: null };
    }
    const problem = parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return { targets: [...DEFAULT_TARGETS], source: 'default', problem: `the runner targets in ${source === 'env' ? 'VOCION_RUNNERS' : 'VOCION_RUNNERS_FILE'} do not parse (${problem}); using the on-box runner alone` };
  } catch (e) {
    return { targets: [...DEFAULT_TARGETS], source: 'default', problem: `the runner targets in ${source === 'env' ? 'VOCION_RUNNERS' : 'VOCION_RUNNERS_FILE'} are not JSON (${(e as Error).message}); using the on-box runner alone` };
  }
}

let cached: { key: string; config: RunnersConfig } | null = null;

/**
 * The installation's runner targets.
 * @param env - The process environment; a test passes its own.
 */
export function runnersConfig(env: Readonly<Record<string, string | undefined>> = process.env): RunnersConfig {
  const key = `${env.VOCION_RUNNERS ?? ''}\u0000${env.VOCION_RUNNERS_FILE ?? ''}`;
  if (cached?.key === key) {
    return cached.config;
  }
  let config: RunnersConfig;
  if (env.VOCION_RUNNERS?.trim()) {
    config = parseRunners(env.VOCION_RUNNERS, 'env');
  } else if (env.VOCION_RUNNERS_FILE?.trim()) {
    let text: string | null = null;
    try {
      text = readFileSync(env.VOCION_RUNNERS_FILE, 'utf8');
    } catch (e) {
      config = { targets: [...DEFAULT_TARGETS], source: 'default', problem: `VOCION_RUNNERS_FILE (${env.VOCION_RUNNERS_FILE}) could not be read (${(e as Error).message}); using the on-box runner alone` };
    }
    config ??= parseRunners(text ?? '', 'file');
  } else {
    config = { targets: [...DEFAULT_TARGETS], source: 'default', problem: null };
  }
  if (config.problem) {
    console.warn(`[runners] ${config.problem}`);
  }
  cached = { key, config };
  return config;
}

/**
 * One target by name, or null when the installation declares no such target.
 * @param name - The target's name, as the runner says it at claim.
 * @param env - The process environment.
 */
export function runnerTarget(name: string, env: Readonly<Record<string, string | undefined>> = process.env): RunnerTarget | null {
  return runnersConfig(env).targets.find(t => t.name === name) ?? null;
}
