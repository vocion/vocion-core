/**
 * DYNAMIC ROUTING (ADR 0006): Jev picks a task's engine, model and effort from
 * candidates Vocion supplies, in front of ADR 0005's static chain.
 *
 * The order is fixed and every step can only narrow:
 *
 * 1. The static route (`routeEngine`): the task's engine, else the seat's,
 *    else the default, inside the installation's fence
 *    (`VOCION_ALLOWED_ENGINES`). This is always computed; it is the answer
 *    whenever Jev is not asked or not used.
 * 2. Off unless there is a key (`resolveJevKey`): no key, no call, and the
 *    run is routed exactly as before this file existed.
 * 3. The candidates: the seat's `harness.routeModels`, else the static
 *    route's own engine and model (so Jev picks the effort only). Anything
 *    outside the fence is dropped before Jev sees it. A task that names its
 *    own engine or model policy is a person's decision and is not put to Jev.
 * 4. Jev answers, or it does not. Any failure (timeout, HTTP error, a body
 *    that is not the documented shape), a pick outside the candidates, `none`,
 *    or a confidence under the threshold means the static route, with the
 *    reason recorded. Nothing here throws.
 *
 * The run's budget is not Jev's: the contract's `budget` and the runner's
 * wall clock hold whatever engine or effort is chosen.
 */

import type { Effort, JevAnswer, JevCandidate, JevDeps, JevFailure, JevQuestion, JevSettings } from './jev';
import type { KeyScope } from './jevKey';
import type { EnginePolicy } from '@/libs/actions/factory-dispatch';
import type { EngineId, EngineRoute, TaskFeatures } from '@/services/factory/engineRouter';
import { allowedEngines, engineIdOf, routeEngine } from '@/services/factory/engineRouter';
import { decide, isJevFailure, jevSettings } from './jev';

export type CostTier = 'high' | 'low' | 'medium';

/** One engine-and-model a seat offers Jev (`harness.routeModels`). */
export type RouteModel = { engine: EngineId; model?: string; about?: string; cost?: CostTier };

/** What the seat says about its model, effort and candidates. */
export type SeatRouting = { model: string | null; effort: string | null; routeModels: RouteModel[] };

/** A candidate as Jev sees it, with what it maps back to. */
export type RouteCandidate = JevCandidate & { engine: EngineId; model: string | null; cost: CostTier };

/** What the run records about how it was routed (`engine_run.route_detail`). */
export type RouteDetail = {
  /** Jev was called. */
  asked: boolean;
  candidates: number;
  /** Jev's pick, as engine and model, when it made one. */
  choice: { engine: EngineId; model: string | null } | null;
  confidence: number | null;
  effort: Effort | null;
  effortConfidence: number | null;
  /** The exact Jev build that answered, else the model asked for. */
  jevModel: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  /** Whose key paid for the call. Never the key. */
  keyScope: KeyScope | null;
  /** Why the static route was used instead, or null when Jev's was. */
  fallback: string | null;
};

/** The router's whole answer: the static shape, plus who chose and what Jev said. */
export type RoutedTask = EngineRoute & {
  selector: 'jev' | 'static';
  /** The model to run, when the route sets one. */
  model: string | null;
  /** The effort to run at, when the route sets one. */
  effort: Effort | null;
  /** Null when Jev was not in play at all (no key, or the task names its engine). */
  detail: RouteDetail | null;
};

/** The task as Jev reads it. Facts at dispatch, no secrets. */
export type RouteTaskInput = {
  orgId: string;
  features: TaskFeatures;
  task: { title: string; objective: string | null; acceptance: number };
  seat: SeatRouting;
  /** The task pins its own model policy: a person's decision, not put to Jev. */
  pinned?: boolean;
};

/** Seams for tests. */
export type RouteDeps = {
  resolveKey?: (orgId: string) => Promise<{ key: string; scope: KeyScope } | null>;
  decide?: (key: string, q: JevQuestion, settings: Pick<JevSettings, 'model' | 'timeoutMs'>, deps?: JevDeps) => Promise<JevAnswer | JevFailure>;
  settings?: JevSettings;
  allowed?: EngineId[] | null;
};

const ENGINE_ABOUT: Record<EngineId, string> = {
  'claude-cli': 'Headless Claude Code: strong at multi-file changes, debugging and following repository conventions.',
  'openhands': 'The OpenHands agent (open source) on the configured model: good at well-specified changes; runs on models the installation chooses.',
};

const OBJECTIVE_CHARS = 1500;
const MAX_CANDIDATES = 12;

/**
 * The candidates Jev may pick from, inside the fence. Pure.
 * @param seat - The seat's routing config.
 * @param fallback - The static route, the one candidate when the seat declares none.
 * @param allowed - The installation's fence, or null.
 */
export function routeCandidates(seat: SeatRouting, fallback: EngineRoute, allowed: EngineId[] | null): RouteCandidate[] {
  const declared: RouteModel[] = seat.routeModels.length > 0
    ? seat.routeModels
    : [{ engine: engineIdOf(fallback.engine), model: fallback.engine?.model ?? (engineIdOf(fallback.engine) === 'claude-cli' ? seat.model ?? undefined : undefined), cost: 'medium' }];
  const seen = new Set<string>();
  const out: RouteCandidate[] = [];
  for (const m of declared) {
    if (allowed && !allowed.includes(m.engine)) {
      continue;
    }
    const model = m.model?.trim() || null;
    const key = `${m.engine}\u0000${model ?? ''}`;
    if (seen.has(key) || out.length >= MAX_CANDIDATES) {
      continue;
    }
    seen.add(key);
    const cost = m.cost ?? 'medium';
    const about = m.about?.trim() || ENGINE_ABOUT[m.engine];
    out.push({
      id: `c${out.length + 1}`,
      engine: m.engine,
      model,
      cost,
      text: `${about} Engine: ${m.engine}. Model: ${model ?? 'the engine\'s default'}. Relative cost: ${cost}.`,
    });
  }
  return out;
}

/**
 * The engine policy a candidate runs as: the shape `routeEngine` answers in.
 * @param c - The candidate.
 */
function policyOf(c: RouteCandidate): EnginePolicy | null {
  if (c.engine === 'claude-cli' && !c.model) {
    return null;
  }
  return { id: c.engine, ...(c.model ? { model: c.model } : {}) };
}

/**
 * What Jev is told about the task. Pure.
 * @param input - The task.
 */
export function routeState(input: RouteTaskInput): Record<string, unknown> {
  const f = input.features;
  return {
    task: input.task.title,
    objective: (input.task.objective ?? '').slice(0, OBJECTIVE_CHARS),
    acceptance_criteria: input.task.acceptance,
    planned_paths: f.plannedPaths,
    size: f.complexity,
    risk_class: f.riskClass ?? 'unknown',
    repository: f.repo ?? 'unknown',
    budget_usd: f.estimatedCents === null ? 'none set' : (f.estimatedCents / 100).toFixed(2),
  };
}

const EFFORT_OK = new Set(['low', 'medium', 'high', 'max']);

/**
 * The route for a task. Never throws; with no key it is `routeEngine` exactly.
 * @param input - The task, its features and its seat.
 * @param deps - Seams for tests.
 */
export async function routeTask(input: RouteTaskInput, deps: RouteDeps = {}): Promise<RoutedTask> {
  const allowed = deps.allowed === undefined ? allowedEngines() : deps.allowed;
  const fixed = routeEngine(input.features, { allowed });
  const seatEffort = input.seat.effort && EFFORT_OK.has(input.seat.effort) ? input.seat.effort as Effort : null;
  const staticRoute = (detail: RouteDetail | null): RoutedTask => ({ ...fixed, selector: 'static', model: null, effort: null, detail });
  if (input.features.taskEngine || input.pinned) {
    return staticRoute(null);
  }
  let resolved: { key: string; scope: KeyScope } | null;
  try {
    resolved = await (deps.resolveKey ?? (async (orgId: string) => (await import('./jevKey')).resolveJevKey(orgId)))(input.orgId);
  } catch {
    return staticRoute(emptyDetail({ fallback: 'the saved Jev key could not be decrypted', keyScope: null, candidates: 0 }));
  }
  if (!resolved) {
    return staticRoute(null);
  }
  const settings = deps.settings ?? jevSettings();
  const candidates = routeCandidates(input.seat, fixed, allowed);
  if (candidates.length === 0) {
    return staticRoute(emptyDetail({ fallback: 'no candidate is allowed on this installation', keyScope: resolved.scope, candidates: 0 }));
  }
  const answer = await (deps.decide ?? decide)(resolved.key, { state: routeState(input), candidates }, settings).catch((): JevFailure => ({ failed: true, kind: 'network', reason: 'Jev could not be reached', latencyMs: 0 }));
  if (isJevFailure(answer)) {
    return staticRoute({ ...emptyDetail({ fallback: answer.reason, keyScope: resolved.scope, candidates: candidates.length }), asked: true, jevModel: settings.model, latencyMs: answer.latencyMs });
  }
  const picked = candidates.length === 1 ? candidates[0]! : candidates.find(c => c.id === answer.choice) ?? null;
  const detail: RouteDetail = {
    asked: true,
    candidates: candidates.length,
    choice: picked ? { engine: picked.engine, model: picked.model } : null,
    confidence: answer.confidence,
    effort: answer.effort,
    effortConfidence: answer.effortConfidence,
    jevModel: answer.model ?? settings.model,
    latencyMs: answer.latencyMs,
    costUsd: answer.costUsd,
    keyScope: resolved.scope,
    fallback: null,
  };
  const fallBack = (why: string): RoutedTask => staticRoute({ ...detail, fallback: why });
  if (candidates.length > 1) {
    if (answer.choice === 'none') {
      return fallBack('Jev found no candidate fits this task');
    }
    if (!picked) {
      return fallBack(`Jev picked "${String(answer.choice).slice(0, 40)}", which is not a candidate`);
    }
    if (answer.confidence === null || answer.confidence < settings.minConfidence) {
      return fallBack(`Jev's confidence ${answer.confidence === null ? 'was missing' : answer.confidence.toFixed(2)} is below ${settings.minConfidence}`);
    }
  }
  // The fence again, on what Jev chose: the candidates were filtered, so this
  // only ever bites if that filter is wrong — and then it clamps, not runs.
  if (allowed && !allowed.includes(picked!.engine)) {
    return fallBack(`Jev picked ${picked!.engine}, which this installation does not allow`);
  }
  const effortTrusted = answer.effort !== null && (answer.effortConfidence ?? 0) >= settings.minConfidence;
  if (candidates.length === 1 && !effortTrusted) {
    // One candidate: the effort was the whole question, and Jev was unsure.
    return fallBack(`Jev's effort confidence ${answer.effortConfidence === null ? 'was missing' : answer.effortConfidence.toFixed(2)} is below ${settings.minConfidence}`);
  }
  const effort = effortTrusted ? answer.effort : seatEffort;
  const conf = answer.confidence === null ? '' : ` (confidence ${answer.confidence.toFixed(2)})`;
  const what = candidates.length > 1 ? `${picked!.engine}${picked!.model ? ` on ${picked!.model}` : ''}${conf}` : `${picked!.engine}, the seat's only candidate`;
  const effortLine = effortTrusted ? `, ${answer.effort} effort` : seatEffort ? `, the seat's ${seatEffort} effort (Jev's effort read was unsure)` : '';
  return {
    engine: policyOf(picked!),
    policy: 'jev',
    reason: `Jev chose ${what}${effortLine}`,
    selector: 'jev',
    model: picked!.model,
    effort,
    detail,
  };
}

function emptyDetail(d: { fallback: string; keyScope: KeyScope | null; candidates: number }): RouteDetail {
  return { asked: false, candidates: d.candidates, choice: null, confidence: null, effort: null, effortConfidence: null, jevModel: null, latencyMs: null, costUsd: null, keyScope: d.keyScope, fallback: d.fallback };
}

/**
 * The seat's routing config, from its harness: `model`, `effort` and
 * `routeModels`. Empty when the seat is gone.
 * @param orgId - The workspace.
 * @param slug - The seat.
 */
export async function seatRouting(orgId: string, slug: string): Promise<SeatRouting> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { agentSchema } = await import('@/models/Schema');
  const [row] = await db.select({ harness: agentSchema.harnessConfig }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug))).limit(1);
  return readSeatRouting(row?.harness);
}

/**
 * The seat's routing config from a harness object. Pure; ignores anything malformed.
 * @param raw - `agent.harness_config`.
 */
export function readSeatRouting(raw: unknown): SeatRouting {
  const h = (raw && typeof raw === 'object' ? raw : {}) as { model?: unknown; effort?: unknown; routeModels?: unknown };
  const engines: EngineId[] = ['claude-cli', 'openhands'];
  const costs: CostTier[] = ['low', 'medium', 'high'];
  const routeModels = Array.isArray(h.routeModels)
    ? h.routeModels.flatMap((m): RouteModel[] => {
        const r = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
        if (typeof r.engine !== 'string' || !(engines as string[]).includes(r.engine)) {
          return [];
        }
        return [{
          engine: r.engine as EngineId,
          ...(typeof r.model === 'string' && r.model.trim() ? { model: r.model.trim() } : {}),
          ...(typeof r.about === 'string' && r.about.trim() ? { about: r.about.trim().slice(0, 400) } : {}),
          ...(typeof r.cost === 'string' && (costs as string[]).includes(r.cost) ? { cost: r.cost as CostTier } : {}),
        }];
      })
    : [];
  return {
    model: typeof h.model === 'string' && h.model.trim() ? h.model.trim() : null,
    effort: typeof h.effort === 'string' ? h.effort : null,
    routeModels,
  };
}

/**
 * Put a route on a contract: its engine (absent for the plain default, so an
 * older runner still accepts the contract), and the model and effort Jev
 * chose. A claude-cli model also goes on `model_policy.model`, which is
 * where that engine has always read it; an engine's own model goes on
 * `engine.model`. Effort is `model_policy.effort`, which both engines pass to
 * their model. Static routes change nothing beyond `engine`.
 * @param contract - The contract, changed in place.
 * @param route - The route.
 */
export function applyRoute(contract: Record<string, unknown>, route: RoutedTask): void {
  if (route.engine) {
    contract.engine = route.engine;
  } else {
    delete contract.engine;
  }
  if (route.selector !== 'jev') {
    return;
  }
  const policy = { ...((contract.model_policy && typeof contract.model_policy === 'object') ? contract.model_policy as Record<string, unknown> : {}) };
  if (route.model && engineIdOf(route.engine) === 'claude-cli') {
    policy.model = route.model;
  }
  if (route.effort) {
    policy.effort = route.effort;
  }
  if (Object.keys(policy).length > 0) {
    contract.model_policy = policy;
  }
}
