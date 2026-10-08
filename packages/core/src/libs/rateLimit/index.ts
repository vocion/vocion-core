/**
 * Rate limits and lockouts — the one limiter every entry point uses.
 *
 *   const verdict = await hit(RATE_LIMITS.signUpPerIp, clientIp(req.headers));
 *   if (!verdict.allowed) return tooManyRequests(verdict);
 *
 * `hit` counts an attempt and refuses once the window's count passes the
 * policy's limit. `peek` reads without counting and refuses once the count has
 * REACHED it, which is the lockout check made before an attempt whose failure
 * is then counted with `hit`; `clear` forgets a subject, so a successful
 * sign-in wipes its failures. Policies live in `./policies.ts`.
 *
 * Three rules keep this from becoming the thing that stops people:
 *
 * - **A missing subject is not limited.** No forwarding header means no IP,
 *   and pooling every such request into one bucket would let one client lock
 *   out everyone (`libs/http/clientIp.ts`).
 * - **A broken store allows.** A counter that cannot be written is logged and
 *   the attempt goes ahead: the limiter defends against abuse, and a database
 *   blip must not sign everybody out of the product.
 * - **`VOCION_RATE_LIMIT=off` turns it all off** — for a test run that signs in
 *   a hundred times from one machine, never for a deployment.
 *
 * Subjects are hashed into the key, so the counters table holds no email or
 * address in the clear.
 */

import type { RateLimitPolicy } from './policies';
import type { RateLimitStore } from './store';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { NextResponse } from 'next/server';
import { memoryRateLimitStore, postgresRateLimitStore } from './store';

export { RATE_LIMITS } from './policies';
export type { RateLimitPolicy } from './policies';

export type RateLimitVerdict
  = | { allowed: true }
    | { allowed: false; retryAfterSeconds: number };

const ALLOWED: RateLimitVerdict = { allowed: true };

const memory = memoryRateLimitStore();
let shared: RateLimitStore | null = null;

function storeFor(policy: RateLimitPolicy): RateLimitStore {
  if (!policy.shared) {
    return memory;
  }
  shared ??= postgresRateLimitStore();
  return shared;
}

/** Whether limits are switched off for this process (`VOCION_RATE_LIMIT=off`). */
export function rateLimitsDisabled(): boolean {
  return (process.env.VOCION_RATE_LIMIT ?? '').toLowerCase() === 'off';
}

function keyFor(policy: RateLimitPolicy, subject: string): string {
  const digest = createHash('sha256').update(subject.trim().toLowerCase()).digest('hex').slice(0, 32);
  return `${policy.name}:${digest}`;
}

function windowOf(policy: RateLimitPolicy, now: Date): { start: Date; end: Date } {
  const span = policy.windowSeconds * 1000;
  const start = Math.floor(now.getTime() / span) * span;
  return { start: new Date(start), end: new Date(start + span) };
}

function refused(end: Date, now: Date): RateLimitVerdict {
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 1000)) };
}

function logStoreFailure(policy: RateLimitPolicy, error: unknown): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger.warn('rate limit store failed; allowing the attempt', {
      policy: policy.name,
      error: error instanceof Error ? error.message : String(error),
    }))
    .catch(() => {});
}

/**
 * Count one attempt by `subject` and say whether it may go ahead.
 * @param policy - Which limit.
 * @param subject - Who is counted (an IP, an email, a user id). Null skips the limit.
 * @param now - The current time; tests pass one.
 */
export async function hit(policy: RateLimitPolicy, subject: string | null | undefined, now: Date = new Date()): Promise<RateLimitVerdict> {
  if (!subject || rateLimitsDisabled()) {
    return ALLOWED;
  }
  const { start, end } = windowOf(policy, now);
  try {
    const count = await storeFor(policy).hit(keyFor(policy, subject), start, end);
    return count > policy.limit ? refused(end, now) : ALLOWED;
  } catch (error) {
    logStoreFailure(policy, error);
    return ALLOWED;
  }
}

/**
 * Whether `subject` is locked out under `policy`, without counting anything.
 * Refuses once the window's count has reached the limit.
 * @param policy - Which lockout.
 * @param subject - Who is checked. Null is never locked out.
 * @param now - The current time; tests pass one.
 */
export async function peek(policy: RateLimitPolicy, subject: string | null | undefined, now: Date = new Date()): Promise<RateLimitVerdict> {
  if (!subject || rateLimitsDisabled()) {
    return ALLOWED;
  }
  const { start, end } = windowOf(policy, now);
  try {
    const count = await storeFor(policy).count(keyFor(policy, subject), start, now);
    return count >= policy.limit ? refused(end, now) : ALLOWED;
  } catch (error) {
    logStoreFailure(policy, error);
    return ALLOWED;
  }
}

/**
 * Forget every count for `subject` under `policy` — a success clears its
 * failures.
 * @param policy - Which limit.
 * @param subject - Who to forget.
 */
export async function clear(policy: RateLimitPolicy, subject: string | null | undefined): Promise<void> {
  if (!subject) {
    return;
  }
  try {
    await storeFor(policy).clear(keyFor(policy, subject));
  } catch (error) {
    logStoreFailure(policy, error);
  }
}

/**
 * The first refusal among several verdicts, or `allowed` when none refused.
 * @param verdicts - Verdicts from `hit` / `peek`.
 */
export function firstRefusal(...verdicts: RateLimitVerdict[]): RateLimitVerdict {
  return verdicts.find(v => !v.allowed) ?? ALLOWED;
}

/**
 * "Try again in 4 minutes" — the wait, in words a person reads. Rounded up to
 * whole minutes past a minute, so it never promises less than the header.
 * @param seconds - The wait.
 */
export function describeWait(seconds: number): string {
  if (seconds < 60) {
    return seconds === 1 ? '1 second' : `${seconds} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * The 429 for a refused attempt, with `Retry-After` in seconds.
 * @param verdict - The refusal.
 * @param body - The JSON body; defaults to `{ error, code: 'RATE_LIMITED', retryAfterSeconds }`.
 */
export function tooManyRequests(verdict: Extract<RateLimitVerdict, { allowed: false }>, body?: unknown): NextResponse {
  return NextResponse.json(
    body ?? {
      error: `Too many attempts. Try again in ${describeWait(verdict.retryAfterSeconds)}.`,
      code: 'RATE_LIMITED',
      retryAfterSeconds: verdict.retryAfterSeconds,
    },
    { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
  );
}

/** Test hook: forget every in-memory count. */
export function resetMemoryRateLimits(): void {
  memory.reset();
}
