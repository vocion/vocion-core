/**
 * WHICH ENGINE BUILDS A TASK (ADR 0005). The factory asks the router once per
 * run, at dispatch, and the answer goes on the contract as `engine` and on the
 * run's input as `route` (which policy chose it, and why), so the scoreboard
 * (`engineRun.ts`) can compare engines by how they were chosen.
 *
 * The router is a chain of policies. Each reads the task's features and either
 * picks an engine or passes (null) to the next. Today the chain is one policy,
 * `staticPolicy`: the task's own engine, else the engineer seat's
 * `harness.engine`, else the runner's default (claude-cli). That is the whole
 * of today's routing, on purpose: a workspace picks its engine in config.
 *
 * THE HOOK FOR DYNAMIC ROUTING: a policy that reads `complexity` or
 * `estimatedCents` (and, later, the scoreboard's own figures) goes in front of
 * `staticPolicy` in `ROUTE_POLICIES`, and passes on anything it has no opinion
 * about. Nothing else changes: the contract, the runner and the scoreboard
 * already carry what it decides.
 *
 * An installation can fence the engines (`VOCION_ALLOWED_ENGINES`, a comma
 * list; a client installation sets `openhands`). A choice outside the fence is
 * replaced by the first engine inside it, and the reason says so.
 */

import type { EnginePolicy } from '@/libs/actions/factory-dispatch';

export type EngineId = EnginePolicy['id'];

/** What a policy may read about the task. Every field is a fact at dispatch. */
export type TaskFeatures = {
  /** The engineer seat (agent slug) that will claim the run. */
  seat: string;
  /** The engine the task itself names, if any. */
  taskEngine: EnginePolicy | null;
  /** The seat's `harness.engine` / `harness.engineModel`, if any. */
  seatEngine: EnginePolicy | null;
  riskClass: string | null;
  repo: string | null;
  /** A size hint: how many paths the plan expects to touch. */
  plannedPaths: number;
  /** `small` | `medium` | `large`, from the plan's size (`complexityOf`). */
  complexity: 'large' | 'medium' | 'small';
  /** The task's budget, in cents, when it has one. */
  estimatedCents: number | null;
};

/** A policy's answer. `engine: null` means the runner's default, claude-cli. */
export type EngineRoute = { engine: EnginePolicy | null; policy: string; reason: string };

/** One link of the chain: picks, or passes with null. */
export type EngineRoutePolicy = {
  name: string;
  route: (features: TaskFeatures) => EngineRoute | null;
};

/**
 * The engine an answer names, the default spelled out.
 * @param engine - The answer's engine; null is the default.
 */
export function engineIdOf(engine: EnginePolicy | null): EngineId {
  return engine?.id ?? 'claude-cli';
}

/**
 * The size of a change, from its files and lines: `small` up to 3 files and
 * 150 lines, `large` from 10 files or 600 lines, `medium` between. Shared by
 * the router (on the plan) and the scoreboard (on what landed).
 * @param files - Files touched or planned.
 * @param lines - Lines added and removed, when known.
 */
export function complexityOf(files: number, lines: number | null = null): TaskFeatures['complexity'] {
  if (files >= 10 || (lines ?? 0) >= 600) {
    return 'large';
  }
  if (files <= 3 && (lines ?? 0) <= 150) {
    return 'small';
  }
  return 'medium';
}

/** Today's routing: the task's engine, else the seat's, else the default. Never passes. */
export const staticPolicy: EngineRoutePolicy = {
  name: 'static',
  route(f) {
    if (f.taskEngine) {
      return { engine: f.taskEngine, policy: 'static', reason: 'the task names its engine' };
    }
    if (f.seatEngine) {
      return { engine: f.seatEngine, policy: 'static', reason: `the ${f.seat} seat's harness.engine` };
    }
    return { engine: null, policy: 'static', reason: 'the default engine; neither the task nor the seat names one' };
  },
};

/** The chain, in order. A dynamic policy goes in front of `staticPolicy`. */
export const ROUTE_POLICIES: readonly EngineRoutePolicy[] = [staticPolicy];

/**
 * The engines this installation allows, from `VOCION_ALLOWED_ENGINES`; null
 * when it does not fence them.
 * @param raw - The variable's value.
 */
export function allowedEngines(raw: string | undefined = process.env.VOCION_ALLOWED_ENGINES): EngineId[] | null {
  const known: EngineId[] = ['claude-cli', 'openhands'];
  const list = String(raw ?? '').split(',').map(s => s.trim()).filter((s): s is EngineId => (known as string[]).includes(s));
  return list.length > 0 ? list : null;
}

/**
 * The engine for a task: the first policy in the chain with an opinion, kept
 * inside the installation's fence.
 * @param features - The task.
 * @param opts - The chain and the fence; both default to the installation's.
 * @param opts.policies - The policies, in order.
 * @param opts.allowed - The engines allowed, or null for any.
 */
export function routeEngine(features: TaskFeatures, opts: { policies?: readonly EngineRoutePolicy[]; allowed?: EngineId[] | null } = {}): EngineRoute {
  const policies = opts.policies ?? ROUTE_POLICIES;
  const allowed = opts.allowed === undefined ? allowedEngines() : opts.allowed;
  let route: EngineRoute | null = null;
  for (const p of policies) {
    route = p.route(features);
    if (route) {
      break;
    }
  }
  route ??= staticPolicy.route(features)!;
  if (allowed && !allowed.includes(engineIdOf(route.engine))) {
    const fallback = allowed[0]!;
    return {
      engine: fallback === 'claude-cli' ? null : { id: fallback },
      policy: route.policy,
      reason: `${route.reason}, but this installation allows only ${allowed.join(', ')}; ${fallback} instead`,
    };
  }
  return route;
}
