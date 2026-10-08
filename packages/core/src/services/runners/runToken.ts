/**
 * THE CREDENTIAL ONE RUN CARRIES (backlog 052; scoped per run in Vocion 5.1). A runner claims with
 * a long-lived credential — the installation runner token on a single-tenant installation, or an
 * account's runner token (`services/runners/runnerTokens.ts`) — and never keeps it near the
 * repository: at claim, core hands the runner a run token bound to that one run, and every call
 * the runner makes for the run (heartbeat, complete, fail, the task record, QA artifacts, the
 * product's QA sign-in) presents it. The runner then drops the long-lived credential before it
 * clones anything (`packages/runner/entrypoint.sh`).
 *
 * `vrt_<payload>.<signature>`: an HMAC over `{ orgId, runId, target, exp, use, workerId }` with a
 * key derived from the app's signing secret for this one purpose, so a tool claim or a session
 * cannot be replayed as one. Two uses:
 *
 * - `run` — the callbacks for one claimed run, bound to the runner that holds its lease
 *   (`workerId`). Short-lived: it lasts `RUN_TOKEN_TTL_MS` and every heartbeat hands back a fresh
 *   one, so a token that leaks stops working soon after its run stops beating, and it is refused
 *   outright once the run is over (`services/runners/runTokenAccess.ts`). It can claim nothing.
 * - `start` — what a target that starts a container for a run (Fargate push,
 *   `services/runners/targets.ts`) puts in that container instead of any long-lived secret. It can
 *   claim its own run, once, while that run is queued, and do nothing else.
 *
 * A token minted before `use` existed reads as `run` with no lease binding, so a run in flight
 * across the deploy that introduced it keeps reporting.
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const RUN_TOKEN_PREFIX = 'vrt_';

/** How long a run token lasts between heartbeats; each heartbeat hands back a fresh one. */
export const RUN_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/** How long a start token waits for its container to boot and claim. */
export const START_TOKEN_TTL_MS = 30 * 60 * 1000;

export type RunTokenUse = 'run' | 'start';

export type RunTokenClaim = {
  orgId: string;
  runId: number;
  target: string;
  exp: number;
  use: RunTokenUse;
  /** The lease holder a `run` token was minted for; absent on a start token and on a legacy token. */
  workerId?: string;
};

function key(): Buffer {
  const s = process.env.VOCION_TOOL_SIGNING_SECRET || process.env.AUTH_SECRET;
  if (!s) {
    throw new Error('run tokens: VOCION_TOOL_SIGNING_SECRET or AUTH_SECRET must be set');
  }
  return createHmac('sha256', s).update('vocion:runner:run-token:v1').digest();
}

function sign(body: string): Buffer {
  return createHmac('sha256', key()).update(body).digest();
}

function mint(claim: Omit<RunTokenClaim, 'exp'>, ttlMs: number): string {
  const body = Buffer.from(JSON.stringify({ ...claim, exp: Date.now() + ttlMs }), 'utf8').toString('base64url');
  return `${RUN_TOKEN_PREFIX}${body}.${sign(body).toString('base64url')}`;
}

/**
 * A run token for one claimed run: the callbacks for that run, by the runner holding its lease.
 * @param claim - The workspace, the run, the target that claimed it and the lease holder.
 * @param claim.orgId - The workspace.
 * @param claim.runId - The run.
 * @param claim.target - The target that claimed it.
 * @param claim.workerId - The lease holder; the token is refused once someone else holds the run.
 * @param ttlMs - How long it lasts before a heartbeat must renew it.
 */
export function signRunToken(claim: { orgId: string; runId: number; target: string; workerId?: string | null }, ttlMs = RUN_TOKEN_TTL_MS): string {
  return mint({ orgId: claim.orgId, runId: claim.runId, target: claim.target, use: 'run', ...(claim.workerId ? { workerId: claim.workerId } : {}) }, ttlMs);
}

/**
 * A start token: what a container started for one run holds instead of a long-lived secret. It
 * claims that run and nothing else.
 * @param claim - The workspace, the run and the target that starts the container.
 * @param claim.orgId - The workspace.
 * @param claim.runId - The run.
 * @param claim.target - The target that starts the container.
 * @param ttlMs - How long the container has to boot and claim.
 */
export function signStartToken(claim: { orgId: string; runId: number; target: string }, ttlMs = START_TOKEN_TTL_MS): string {
  return mint({ orgId: claim.orgId, runId: claim.runId, target: claim.target, use: 'start' }, ttlMs);
}

/**
 * The claim a run token carries, or null when it is not one, is forged, or has expired. Says
 * nothing about whether the run still accepts it: that is `services/runners/runTokenAccess.ts`.
 * @param raw - The bearer value.
 */
export function verifyRunToken(raw: string): RunTokenClaim | null {
  if (!raw.startsWith(RUN_TOKEN_PREFIX)) {
    return null;
  }
  const token = raw.slice(RUN_TOKEN_PREFIX.length);
  const dot = token.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const body = token.slice(0, dot);
  let provided: Buffer;
  try {
    provided = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return null;
  }
  const expected = sign(body);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }
  try {
    const claim = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<RunTokenClaim>;
    if (typeof claim.orgId !== 'string' || !Number.isInteger(claim.runId) || typeof claim.target !== 'string' || typeof claim.exp !== 'number' || claim.exp <= Date.now()) {
      return null;
    }
    const use: RunTokenUse = claim.use === 'start' ? 'start' : 'run';
    if (claim.use !== undefined && claim.use !== 'run' && claim.use !== 'start') {
      return null;
    }
    return { orgId: claim.orgId, runId: claim.runId as number, target: claim.target, exp: claim.exp, use, ...(typeof claim.workerId === 'string' && claim.workerId ? { workerId: claim.workerId } : {}) };
  } catch {
    return null;
  }
}

/**
 * Whether a bearer value is the installation runner token (`VOCION_RUNNER_TOKEN`). Compared in
 * constant time; an installation with none set accepts nothing. Whether the installation still
 * honours it (a multi-tenant one does not) is the claim route's call.
 * @param raw - The bearer value.
 * @param env - The process environment.
 */
export function isInstallationRunnerToken(raw: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const want = env.VOCION_RUNNER_TOKEN?.trim();
  if (!want || !raw) {
    return false;
  }
  const a = Buffer.from(raw);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
