import type { NotificationChannel, NotificationPreferences } from '@/libs/notifications/types';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { apnsConfig } from '@/libs/notifications/apns';
import { channelsFor } from '@/libs/notifications/preferences';
import { quietUntil } from '@/libs/notifications/quietHours';
import { slackToken } from '@/libs/notifications/slack';
import { smsConfigured } from '@/libs/notifications/sms';
import { vapidConfig } from '@/libs/notifications/webPush';
import { notificationDeliverySchema, notificationSchema, pushSubscriptionSchema } from '@/models/Schema';
import { getPreferences } from './preferences';

/**
 * notify() — THE ONE WRITER of the notification noun (backlog 048). A declared
 * rule on the event bus calls it (`rules.ts`); nothing else writes a
 * notification. One row per person, deduplicated on `dedupeKey`, so one stop is
 * one notification however often its event is raised; one delivery row per
 * channel the person has on; then the channels that go now are delivered.
 *
 * Live: a notification publishes itself. The `notification_live_tg` trigger
 * (migration 0156) rings `notification:<userId>` on the workspace live stream
 * (backlog 050) whenever a row is written or read, in the writer's own
 * transaction and from whichever process wrote it, so nothing here publishes
 * by hand. The bell follows that topic (`useUnreadNotifications`).
 */

export type NotifyInput = {
  orgId: string;
  kind: string;
  userIds: readonly string[];
  title: string;
  body?: string | null;
  /** Workspace-prefixed app path. */
  link?: string | null;
  record?: { type: string; id: string } | null;
  /** Per person: the same key twice is one notification. */
  dedupeKey: string;
  eventType?: string | null;
  eventId?: number | null;
};

export type NotifyResult = { created: number[]; deduped: number };

/** Email waits this long so several notifications landing together are one mail. */
export const EMAIL_GROUP_MS = 60_000;

export type ServerChannels = { ios: boolean; web: boolean; email: boolean; slack: boolean; sms: boolean };

/** Which outbound channels this server can send at all. */
export async function serverChannels(): Promise<ServerChannels> {
  const { mailEnabled } = await import('@/libs/mail');
  return { ios: apnsConfig() !== null, web: vapidConfig() !== null, email: mailEnabled(), slack: slackToken() !== null, sms: smsConfigured() };
}

type PlannedDelivery = {
  channel: NotificationChannel;
  subscriptionId: number | null;
  status: 'pending' | 'sent' | 'skipped';
  nextAttemptAt: Date;
  detail: string | null;
  sentAt: Date | null;
};

const NOT_CONFIGURED: Record<Exclude<NotificationChannel, 'in_app'>, string> = {
  ios: 'not configured: this server has no APNs key (VOCION_APNS_KEY, VOCION_APNS_KEY_ID, VOCION_APNS_TEAM_ID, VOCION_APNS_BUNDLE_ID)',
  web: 'not configured: this server has no VAPID keys (VOCION_VAPID_PUBLIC_KEY, VOCION_VAPID_PRIVATE_KEY)',
  email: 'not configured: outbound mail is off on this server (VOCION_MAIL_ENABLED)',
  slack: 'not configured: this server has no Slack app (SLACK_BOT_TOKEN)',
  sms: 'not configured: this server has no Twilio account (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)',
};

/**
 * Which deliveries one notification gets. Pure: the person's settings, their
 * devices and what the server can send decide it.
 *
 * - In-app is the notification itself: `sent` on write.
 * - iPhone and Chrome: one delivery per registered device of that platform,
 *   none when the person has no such device (on means "on for the devices
 *   you asked for").
 * - Email waits a minute (`EMAIL_GROUP_MS`) so a burst is one mail.
 * - Push, email and Slack inside quiet hours wait for them to end.
 * - A channel the server cannot send is `skipped`, saying why.
 * @param opts - What decides it.
 * @param opts.kind - The notification kind.
 * @param opts.prefs - The person's settings.
 * @param opts.devices - The person's devices.
 * @param opts.server - What the server can send.
 * @param opts.now - The clock.
 */
export function planDeliveries(opts: { kind: string; prefs: NotificationPreferences; devices: ReadonlyArray<{ id: number; platform: string }>; server: ServerChannels; now: Date }): PlannedDelivery[] {
  const { now } = opts;
  const quiet = quietUntil(now, opts.prefs.quietHours);
  const later = quiet ?? now;
  const out: PlannedDelivery[] = [];
  for (const channel of channelsFor(opts.prefs, opts.kind)) {
    if (channel === 'in_app') {
      out.push({ channel, subscriptionId: null, status: 'sent', nextAttemptAt: now, detail: null, sentAt: now });
      continue;
    }
    const configured = opts.server[channel];
    const detail = configured ? (quiet ? `waiting for quiet hours to end` : null) : NOT_CONFIGURED[channel];
    const status = configured ? 'pending' : 'skipped';
    if (channel === 'ios' || channel === 'web') {
      for (const d of opts.devices.filter(d => d.platform === channel)) {
        out.push({ channel, subscriptionId: d.id, status, nextAttemptAt: later, detail, sentAt: null });
      }
      continue;
    }
    const at = channel === 'email' ? new Date(Math.max(later.getTime(), now.getTime() + EMAIL_GROUP_MS)) : later;
    out.push({ channel, subscriptionId: null, status, nextAttemptAt: at, detail, sentAt: null });
  }
  return out;
}

/**
 * Write one notification per person and its deliveries, then deliver what
 * goes now. Idempotent per person on `dedupeKey`.
 * @param input - The notification.
 * @param opts - Seams.
 * @param opts.now - The clock.
 * @param opts.deliver - `auto` (default) delivers after the response inside a request, inline elsewhere; `none` leaves it to the delivery pass.
 */
export async function notify(input: NotifyInput, opts: { now?: Date; deliver?: 'auto' | 'inline' | 'none' } = {}): Promise<NotifyResult> {
  const now = opts.now ?? new Date();
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) {
    return { created: [], deduped: 0 };
  }
  const server = await serverChannels();
  const devices = await db
    .select({ id: pushSubscriptionSchema.id, platform: pushSubscriptionSchema.platform, userId: pushSubscriptionSchema.userId })
    .from(pushSubscriptionSchema)
    .where(inArray(pushSubscriptionSchema.userId, userIds));
  const created: number[] = [];
  let deduped = 0;
  for (const userId of userIds) {
    const [row] = await db
      .insert(notificationSchema)
      .values({
        orgId: input.orgId,
        userId,
        kind: input.kind,
        title: input.title.slice(0, 300),
        body: input.body ? input.body.slice(0, 2000) : null,
        link: input.link ?? null,
        recordType: input.record?.type ?? null,
        recordId: input.record?.id ?? null,
        dedupeKey: input.dedupeKey.slice(0, 400),
        eventType: input.eventType ?? null,
        eventId: input.eventId ?? null,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [notificationSchema.orgId, notificationSchema.userId, notificationSchema.dedupeKey] })
      .returning({ id: notificationSchema.id });
    if (!row) {
      deduped += 1;
      continue;
    }
    created.push(row.id);
    const prefs = await getPreferences(userId, input.orgId);
    const plan = planDeliveries({ kind: input.kind, prefs, devices: devices.filter(d => d.userId === userId), server, now });
    if (plan.length > 0) {
      await db.insert(notificationDeliverySchema).values(plan.map(p => ({ ...p, notificationId: row.id, orgId: input.orgId, userId, attempts: 0, createdAt: now, updatedAt: now })));
    }
  }
  if (created.length > 0 && opts.deliver !== 'none') {
    const { deliverDue } = await import('./delivery');
    const run = () => deliverDue({ notificationIds: created }).catch((err) => {
      // The rows are pending: the delivery pass picks them up again.
      console.warn('[notifications] immediate delivery failed; the delivery pass will retry', { error: (err as Error).message });
    });
    if (opts.deliver === 'inline' || !(await scheduleAfterResponse(run))) {
      await run();
    }
  }
  return { created, deduped };
}

/**
 * Hold work until after the response when inside a request (Next's `after`);
 * false outside one (a script, the durable executor), where the caller runs it.
 * @param work - The work.
 */
async function scheduleAfterResponse(work: () => Promise<unknown>): Promise<boolean> {
  try {
    const { after } = await import('next/server');
    after(work);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a person's notifications read.
 * @param userId - The person.
 * @param orgId - The workspace.
 * @param ids - The notifications, or `all`.
 * @param now - The clock.
 */
export async function markRead(userId: string, orgId: string, ids: readonly number[] | 'all', now: Date = new Date()): Promise<number> {
  const { isNull } = await import('drizzle-orm');
  const where = and(
    eq(notificationSchema.userId, userId),
    eq(notificationSchema.orgId, orgId),
    isNull(notificationSchema.readAt),
    ids === 'all' ? undefined : inArray(notificationSchema.id, ids.length > 0 ? [...ids] : [-1]),
  );
  // The row's trigger tells the person's open tabs (migration 0156).
  const rows = await db.update(notificationSchema).set({ readAt: now }).where(where).returning({ id: notificationSchema.id });
  return rows.length;
}
