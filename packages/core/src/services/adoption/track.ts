import type { AdoptionEventMeta, AdoptionEventType } from './events';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, userActivityEventSchema } from '@/models/Schema';
import { ADOPTION_EVENTS, isHumanActor } from './events';

/**
 * Logger is loaded lazily: its module has a top-level await, and this
 * file rides along in CLI-script import chains (workspace:apply, the
 * backfill) that tsx compiles as CJS, where top-level await is fatal.
 * Logging failures are swallowed — it's telemetry about telemetry.
 * @param message
 * @param properties
 */
function logWarn(message: string, properties: Record<string, unknown>): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger.warn(message, properties))
    .catch(() => {});
}

/**
 * The one write API for the adoption event stream.
 *
 * `track()` is fire-and-forget: it validates against the registry, inserts,
 * and swallows every failure with a log line — it can never break or slow the
 * user action it rides on. It lives at the service layer (not oRPC
 * middleware) so every entry path — web UI, background worker, agent-runtime
 * tool calls — hits the same choke point.
 */

/** Exactly the shape `guardAuth()` returns (extra fields ignored). */
export type AdoptionActor = {
  orgId: string;
  userId: string;
  projectId?: string | null;
  accountId?: string | null;
};

export type TrackOpts<T extends AdoptionEventType> = {
  /** Set when the event is agent-attributable. */
  agentSlug?: string | null;
  /** Powers drill-down deep links, e.g. `['skill_run', run.id]`. */
  resource?: [type: string, id: string | number];
  meta?: AdoptionEventMeta<T>;
  /** Event timestamp override — used only by the historical backfill. */
  at?: Date;
};

export { isHumanActor } from './events';

/**
 * Record one adoption event. Never throws; failures log and are dropped.
 * @param actor
 * @param eventType
 * @param opts
 */
export async function track<T extends AdoptionEventType>(
  actor: AdoptionActor,
  eventType: T,
  opts: TrackOpts<T> = {},
): Promise<void> {
  try {
    if (!isHumanActor(actor.userId) || !actor.orgId) {
      return;
    }
    const spec = ADOPTION_EVENTS[eventType] as { meta?: { safeParse: (v: unknown) => { success: boolean; error?: unknown } } };
    if (spec.meta && opts.meta !== undefined) {
      const parsed = spec.meta.safeParse(opts.meta);
      if (!parsed.success) {
        logWarn('adoption.track dropped event with malformed metadata', { eventType, error: String(parsed.error) });
        return;
      }
    }
    await db
      .insert(userActivityEventSchema)
      .values({
        orgId: actor.orgId,
        projectId: actor.projectId ?? null,
        userId: actor.userId,
        agentSlug: opts.agentSlug ?? null,
        eventType,
        resourceType: opts.resource?.[0] ?? null,
        resourceId: opts.resource ? String(opts.resource[1]) : null,
        metadata: (opts.meta as Record<string, unknown> | undefined) ?? null,
        ...(opts.at ? { createdAt: opts.at } : {}),
      })
      .onConflictDoNothing();
  } catch (error) {
    logWarn('adoption.track insert failed', { eventType, error: String(error) });
  }
}

/* ------------------------------------------------------------------ */
/* Heartbeat — throttled "this user was active right now"              */
/* ------------------------------------------------------------------ */

const HEARTBEAT_BUCKET_MS = 5 * 60_000;
/** userId:orgId → last bucket written. Per-instance; worst case across instances is one duplicate row per bucket, harmless to the derived metrics. */
const heartbeatBuckets = new Map<string, number>();

/**
 * First authenticated RPC in each 5-minute bucket per user writes one
 * `activity.heartbeat` event and touches `account_membership.last_active_at`.
 * Synchronous no-op the rest of the time, so `guardAuth()` stays free.
 * @param actor
 */
export function trackHeartbeat(actor: AdoptionActor): void {
  if (!isHumanActor(actor.userId) || !actor.orgId) {
    return;
  }
  const key = `${actor.userId}:${actor.orgId}`;
  const bucket = Math.floor(Date.now() / HEARTBEAT_BUCKET_MS);
  if (heartbeatBuckets.get(key) === bucket) {
    return;
  }
  heartbeatBuckets.set(key, bucket);
  void (async () => {
    await track(actor, 'activity.heartbeat');
    await touchMembership(actor, { lastActiveAt: new Date() });
  })();
}

/**
 * Sign-in moment: one `auth.login` event + `last_login_at` stamp.
 * Fire-and-forget like everything else here.
 * @param actor
 */
export function trackLogin(actor: AdoptionActor): void {
  void (async () => {
    await track(actor, 'auth.login');
    const now = new Date();
    await touchMembership(actor, { lastLoginAt: now, lastActiveAt: now });
  })();
}

async function touchMembership(
  actor: AdoptionActor,
  patch: { lastLoginAt?: Date; lastActiveAt?: Date },
): Promise<void> {
  if (!actor.accountId) {
    return;
  }
  try {
    await db
      .update(accountMembershipSchema)
      .set(patch)
      .where(and(
        eq(accountMembershipSchema.accountId, actor.accountId),
        eq(accountMembershipSchema.userId, actor.userId),
      ));
  } catch (error) {
    logWarn('adoption.track membership touch failed', { error: String(error) });
  }
}
