/**
 * THE CREDENTIAL ONE RUN CARRIES (backlog 052). An installation's runner fleet holds one secret,
 * the installation runner token, and builds any workspace's runs with it. It never holds a
 * workspace's token: at claim, core hands the runner a run token scoped to the workspace that
 * queued the run, and every call the runner makes for that run (heartbeat, complete, fail, the task
 * record, QA artifacts, the product's QA sign-in) presents it.
 *
 * `vrt_<payload>.<signature>`: an HMAC over `{ orgId, runId, target, exp }` with a key derived from
 * the app's signing secret for this one purpose, so a tool claim or a session cannot be replayed as
 * one. It lasts as long as a run can, and it is never given to the engineer's process (the runner
 * keeps it in memory; its child environment carries no Vocion credential).
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const RUN_TOKEN_PREFIX = 'vrt_';

/** Long enough for the longest run the runner allows plus its landing, short enough to be useless later. */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

export type RunTokenClaim = { orgId: string; runId: number; target: string; exp: number };

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

/**
 * A run token for one claimed run.
 * @param claim - The workspace, the run and the target that claimed it.
 * @param claim.orgId - The workspace.
 * @param claim.runId - The run.
 * @param claim.target - The target that claimed it.
 * @param ttlMs - How long it lasts.
 */
export function signRunToken(claim: Omit<RunTokenClaim, 'exp'>, ttlMs = DEFAULT_TTL_MS): string {
  const body = Buffer.from(JSON.stringify({ ...claim, exp: Date.now() + ttlMs }), 'utf8').toString('base64url');
  return `${RUN_TOKEN_PREFIX}${body}.${sign(body).toString('base64url')}`;
}

/**
 * The claim a run token carries, or null when it is not one, is forged, or has expired.
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
    const claim = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as RunTokenClaim;
    if (typeof claim.orgId !== 'string' || !Number.isInteger(claim.runId) || typeof claim.exp !== 'number' || claim.exp <= Date.now()) {
      return null;
    }
    return claim;
  } catch {
    return null;
  }
}

/**
 * Whether a bearer value is the installation runner token (`VOCION_RUNNER_TOKEN`). Compared in
 * constant time; an installation with none set accepts nothing.
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
