import type { ChannelOutcome, NotificationMessage } from '@/libs/notifications/outcome';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { appBaseUrl } from '@/libs/links';
import { apnsConfig, sendApns } from '@/libs/notifications/apns';
import { sendSlack, slackToken } from '@/libs/notifications/slack';
import { sendSmsNotification } from '@/libs/notifications/sms';
import { sendWebPush, vapidConfig } from '@/libs/notifications/webPush';
import { chatChannelBindingSchema, notificationDeliverySchema, notificationSchema, projectSchema, pushSubscriptionSchema, userSchema } from '@/models/Schema';
import { contactsOf } from './people';
import { getPreferences } from './preferences';

/**
 * THE DELIVERY PASS (backlog 048) — one queue, every channel.
 *
 * `notify()` kicks it for what it just wrote; the durable executor runs it
 * every 15 seconds for everything else (`services/background/housekeeping.ts`): retries,
 * mail held for grouping, and anything quiet hours held. Rows are claimed with
 * `FOR UPDATE SKIP LOCKED` under a two-minute lease, so the kick and the loop
 * never send one delivery twice, and a process that dies mid-send leaves the
 * row to be claimed again when the lease runs out.
 *
 * A failed channel never blocks the others: each delivery is its own row and
 * its own outcome. A retryable failure backs off (30s, 2m, 10m, 30m) carrying
 * its reason; past the last attempt the row is `failed` with that reason,
 * which the notification list shows. A subscription the push service calls
 * gone is removed.
 */

export const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];
const LEASE_MS = 120_000;

export type DeliverySummary = { claimed: number; sent: number; retrying: number; failed: number; skipped: number };

type Claimed = { id: number; notificationId: number; orgId: string; userId: string; channel: string; subscriptionId: number | null; attempts: number };

/**
 * A clock value for raw SQL against a `timestamp` (no zone) column. The ORM
 * writes those columns as UTC ISO strings; a bare `Date` bound into raw SQL is
 * serialised by node-postgres in the PROCESS's zone and the offset dropped by
 * the cast, which on a machine west of UTC put every row hours in the future
 * and nothing was ever due (found on local Postgres, 2026-09-30). PGlite binds
 * UTC, which is why the unit tests alone never saw it.
 * @param d - The instant.
 */
function utc(d: Date): ReturnType<typeof sql> {
  return sql`${d.toISOString()}::timestamp`;
}

async function claim(where: ReturnType<typeof sql>, now: Date, limit: number): Promise<Claimed[]> {
  const lease = utc(new Date(now.getTime() + LEASE_MS));
  const res = await db.execute<{ id: number; notification_id: number; org_id: string; user_id: string; channel: string; subscription_id: number | null; attempts: number }>(sql`
    UPDATE notification_delivery SET attempts = attempts + 1, next_attempt_at = ${lease}, updated_at = ${utc(now)}
    WHERE id IN (
      SELECT id FROM notification_delivery
      WHERE status = 'pending' AND ${where}
      ORDER BY next_attempt_at ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, notification_id, org_id, user_id, channel, subscription_id, attempts
  `);
  const rows = (res as unknown as { rows: Array<{ id: number; notification_id: number; org_id: string; user_id: string; channel: string; subscription_id: number | null; attempts: number }> }).rows;
  return rows.map(r => ({ id: r.id, notificationId: r.notification_id, orgId: r.org_id, userId: r.user_id, channel: r.channel, subscriptionId: r.subscription_id, attempts: Number(r.attempts) }));
}

function idList(ids: readonly number[]): ReturnType<typeof sql> {
  return sql.join(ids.map(id => sql`${id}`), sql`, `);
}

/**
 * Deliver every due delivery, or only those of the notifications named.
 * @param opts - What to deliver.
 * @param opts.now - The clock.
 * @param opts.limit - At most this many claims per call.
 * @param opts.notificationIds - Only these notifications' deliveries (the kick after `notify`).
 * @param opts.send - Channel senders, injectable for tests.
 */
export async function deliverDue(opts: { now?: Date; limit?: number; notificationIds?: readonly number[]; send?: Partial<Senders> } = {}): Promise<DeliverySummary> {
  const now = opts.now ?? new Date();
  const summary: DeliverySummary = { claimed: 0, sent: 0, retrying: 0, failed: 0, skipped: 0 };
  if (opts.notificationIds && opts.notificationIds.length === 0) {
    return summary;
  }
  const scope = opts.notificationIds
    ? sql`next_attempt_at <= ${utc(now)} AND notification_id IN (${idList(opts.notificationIds)})`
    : sql`next_attempt_at <= ${utc(now)}`;
  const claimed = await claim(scope, now, opts.limit ?? 100);
  if (claimed.length === 0) {
    return summary;
  }
  // Mail is grouped: every other pending mail for the same person in the same
  // workspace rides along with the one that came due.
  const emailOwners = new Map<string, { orgId: string; userId: string }>();
  for (const c of claimed.filter(c => c.channel === 'email')) {
    emailOwners.set(`${c.orgId}\0${c.userId}`, { orgId: c.orgId, userId: c.userId });
  }
  const claimedIds = new Set(claimed.map(c => c.id));
  for (const owner of emailOwners.values()) {
    const riders = await claim(sql`channel = 'email' AND org_id = ${owner.orgId} AND user_id = ${owner.userId}`, now, 50);
    for (const r of riders.filter(r => !claimedIds.has(r.id))) {
      claimed.push(r);
      claimedIds.add(r.id);
    }
  }
  summary.claimed = claimed.length;
  const senders: Senders = { ...defaultSenders(), ...opts.send };
  const ctx = await loadContext(claimed);

  const record = async (c: Claimed, outcome: ChannelOutcome) => {
    const tally = await applyOutcome(c, outcome, now);
    summary[tally] += 1;
  };

  const emailGroups = new Map<string, Claimed[]>();
  for (const c of claimed) {
    const n = ctx.notifications.get(c.notificationId);
    if (!n) {
      await record(c, { status: 'failed', error: 'the notification is gone' });
      continue;
    }
    if (c.channel === 'email') {
      const key = `${c.orgId}\0${c.userId}`;
      emailGroups.set(key, [...(emailGroups.get(key) ?? []), c]);
      continue;
    }
    try {
      await record(c, await sendOne(c, n, ctx, senders));
    } catch (err) {
      // A sender that threw is a retry with its reason, never a lost row.
      await record(c, { status: 'retry', error: (err as Error).message });
    }
  }
  for (const group of emailGroups.values()) {
    let outcome: ChannelOutcome;
    try {
      outcome = await senders.email(group[0]!, group.map(c => ctx.notifications.get(c.notificationId)!).filter(Boolean), ctx);
    } catch (err) {
      outcome = { status: 'retry', error: (err as Error).message };
    }
    for (const c of group) {
      await record(c, outcome);
    }
  }
  return summary;
}

type Notification = typeof notificationSchema.$inferSelect;
type Subscription = typeof pushSubscriptionSchema.$inferSelect;

export type DeliveryContext = {
  notifications: Map<number, Notification>;
  subscriptions: Map<number, Subscription>;
  contacts: Map<string, { email: string; name: string | null }>;
  workspaces: Map<string, { name: string; slug: string }>;
};

async function loadContext(claimed: readonly Claimed[]): Promise<DeliveryContext> {
  const nIds = [...new Set(claimed.map(c => c.notificationId))];
  const sIds = [...new Set(claimed.map(c => c.subscriptionId).filter((v): v is number => v !== null))];
  const orgIds = [...new Set(claimed.map(c => c.orgId))];
  const [notifications, subscriptions, projects, contacts] = await Promise.all([
    db.select().from(notificationSchema).where(inArray(notificationSchema.id, nIds)),
    sIds.length > 0 ? db.select().from(pushSubscriptionSchema).where(inArray(pushSubscriptionSchema.id, sIds)) : Promise.resolve([] as Subscription[]),
    db.select({ id: projectSchema.id, name: projectSchema.name, slug: projectSchema.slug }).from(projectSchema).where(inArray(projectSchema.id, orgIds)),
    contactsOf([...new Set(claimed.filter(c => c.channel === 'email' || c.channel === 'slack').map(c => c.userId))]),
  ]);
  return {
    notifications: new Map(notifications.map(n => [n.id, n])),
    subscriptions: new Map(subscriptions.map(s => [s.id, s])),
    contacts,
    workspaces: new Map(projects.map(p => [p.id, { name: p.name, slug: p.slug }])),
  };
}

/**
 * The absolute URL a notification opens: the deployment's origin before the
 * stored workspace path. With no `NEXT_PUBLIC_APP_URL` the path stays
 * relative — the service worker and the app resolve it against their host.
 * @param link - The stored link.
 */
export function absoluteLink(link: string | null): string | null {
  if (!link) {
    return null;
  }
  const base = appBaseUrl();
  return base ? `${base}${link}` : link;
}

export function messageOf(n: Notification): NotificationMessage {
  return { id: n.id, kind: n.kind, title: n.title, body: n.body, url: absoluteLink(n.link) };
}

export type Senders = {
  web: (sub: Subscription, message: NotificationMessage) => Promise<ChannelOutcome>;
  ios: (sub: Subscription, message: NotificationMessage) => Promise<ChannelOutcome>;
  slack: (c: Claimed, message: NotificationMessage, ctx: DeliveryContext) => Promise<ChannelOutcome>;
  email: (first: Claimed, notifications: Notification[], ctx: DeliveryContext) => Promise<ChannelOutcome>;
  sms: (c: Claimed, message: NotificationMessage) => Promise<ChannelOutcome>;
};

/**
 * Who a text goes to and the number it comes from, or why there is none.
 * @param orgId - The workspace the notification is about.
 * @param userId - The person.
 */
export async function smsTargetFor(orgId: string, userId: string): Promise<{ from: string; to: string } | { error: string }> {
  const [user] = await db.select({ phone: userSchema.phone }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  if (!user?.phone) {
    return { error: 'this person has no mobile number on their profile — in Vocion chat, say "my mobile number is …"' };
  }
  const { textingNumberFor } = await import('@/services/chat/smsChannel');
  const from = await textingNumberFor(orgId);
  if (!from) {
    return { error: 'no text number is bound to this workspace or its Org — bind one (`answers: "sender"` makes it the Org\'s shared number)' };
  }
  return { from, to: user.phone };
}

function defaultSenders(): Senders {
  return {
    web: (sub, message) => sub.keys
      ? sendWebPush({ endpoint: sub.token, keys: sub.keys }, message, vapidConfig())
      : Promise.resolve({ status: 'gone', error: 'the stored browser subscription has no keys' }),
    ios: (sub, message) => sendApns({ token: sub.token, environment: sub.environment, bundleId: sub.bundleId }, message, apnsConfig()),
    slack: async (c, message, ctx) => {
      const prefs = await getPreferences(c.userId, c.orgId);
      if (prefs.slackTarget === 'channel') {
        const [binding] = await db
          .select({ channelId: chatChannelBindingSchema.channelId })
          .from(chatChannelBindingSchema)
          .where(and(eq(chatChannelBindingSchema.orgId, c.orgId), eq(chatChannelBindingSchema.surface, 'slack'), ne(chatChannelBindingSchema.channelId, '*')))
          .orderBy(asc(chatChannelBindingSchema.id))
          .limit(1);
        if (!binding) {
          return { status: 'failed', error: 'this workspace has no Slack channel bound — bind one, or choose a DM in notification settings' };
        }
        return sendSlack({ channelId: binding.channelId }, message, slackToken());
      }
      const email = ctx.contacts.get(c.userId)?.email;
      return email ? sendSlack({ dmEmail: email }, message, slackToken()) : { status: 'failed', error: 'this person has no email to find them in Slack by' };
    },
    sms: async (c, message) => {
      const target = await smsTargetFor(c.orgId, c.userId);
      return 'error' in target ? { status: 'failed', error: target.error } : sendSmsNotification(target, message);
    },
    email: async (first, notifications, ctx) => {
      const { mailEnabled, sendMail } = await import('@/libs/mail');
      if (!mailEnabled()) {
        return { status: 'not_configured', error: 'outbound mail is off on this server (VOCION_MAIL_ENABLED)' };
      }
      const to = ctx.contacts.get(first.userId)?.email;
      if (!to) {
        return { status: 'failed', error: 'this person has no email address' };
      }
      const { workspaceFrom } = await import('@/services/mail/workspaceFrom');
      const rendered = renderNotificationEmail(notifications.map(messageOf), ctx.workspaces.get(first.orgId)?.name ?? 'your workspace');
      const from = await workspaceFrom(first.orgId);
      const sent = await sendMail({ to, subject: rendered.subject, text: rendered.text, html: rendered.html, ...(from ? { from } : {}), tags: { kind: 'notification' }, brand: { orgId: first.orgId } });
      return sent.skipped ? { status: 'not_configured', error: 'outbound mail is off on this server' } : { status: 'sent' };
    },
  };
}

async function sendOne(c: Claimed, n: Notification, ctx: DeliveryContext, senders: Senders): Promise<ChannelOutcome> {
  const message = messageOf(n);
  if (c.channel === 'web' || c.channel === 'ios') {
    const sub = c.subscriptionId !== null ? ctx.subscriptions.get(c.subscriptionId) : undefined;
    if (!sub) {
      return { status: 'failed', error: 'the device was removed' };
    }
    return c.channel === 'web' ? senders.web(sub, message) : senders.ios(sub, message);
  }
  if (c.channel === 'slack') {
    return senders.slack(c, message, ctx);
  }
  if (c.channel === 'sms') {
    return senders.sms(c, message);
  }
  if (c.channel === 'in_app') {
    return { status: 'sent' };
  }
  return { status: 'failed', error: `unknown channel ${c.channel}` };
}

/**
 * Write one outcome onto its delivery row, and onto the device when a device
 * failed or is gone.
 * @param c - The claimed delivery.
 * @param outcome - What the channel said.
 * @param now - The clock.
 * @returns Which tally it counts toward.
 */
async function applyOutcome(c: Claimed, outcome: ChannelOutcome, now: Date): Promise<'sent' | 'retrying' | 'failed' | 'skipped'> {
  const set = (values: Partial<typeof notificationDeliverySchema.$inferInsert>) => db.update(notificationDeliverySchema).set({ ...values, updatedAt: now }).where(eq(notificationDeliverySchema.id, c.id));
  switch (outcome.status) {
    case 'sent':
      await set({ status: 'sent', sentAt: now, detail: null });
      if (c.subscriptionId !== null) {
        await db.update(pushSubscriptionSchema).set({ lastSeenAt: now, lastError: null }).where(eq(pushSubscriptionSchema.id, c.subscriptionId));
      }
      return 'sent';
    case 'not_configured':
      await set({ status: 'skipped', detail: outcome.error });
      return 'skipped';
    case 'gone':
      await set({ status: 'failed', detail: `${outcome.error}; the device was removed` });
      if (c.subscriptionId !== null) {
        await db.delete(pushSubscriptionSchema).where(eq(pushSubscriptionSchema.id, c.subscriptionId));
      }
      return 'failed';
    case 'retry':
      if (c.attempts < MAX_ATTEMPTS) {
        const wait = BACKOFF_MS[Math.min(c.attempts - 1, BACKOFF_MS.length - 1)]!;
        await set({ status: 'pending', nextAttemptAt: new Date(now.getTime() + wait), detail: `attempt ${c.attempts} of ${MAX_ATTEMPTS} failed, retrying: ${outcome.error}` });
        return 'retrying';
      }
      await set({ status: 'failed', detail: `gave up after ${c.attempts} attempts: ${outcome.error}` });
      await noteDeviceError(c, outcome.error);
      return 'failed';
    case 'failed':
      await set({ status: 'failed', detail: outcome.error });
      await noteDeviceError(c, outcome.error);
      return 'failed';
  }
}

async function noteDeviceError(c: Claimed, error: string): Promise<void> {
  if (c.subscriptionId !== null) {
    await db.update(pushSubscriptionSchema).set({ lastError: error.slice(0, 300) }).where(eq(pushSubscriptionSchema.id, c.subscriptionId));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * One mail for one or several notifications. Exported for the test.
 * @param messages - The notifications, oldest first.
 * @param workspaceName - For the subject.
 */
export function renderNotificationEmail(messages: readonly NotificationMessage[], workspaceName: string): { subject: string; text: string; html: string } {
  const subject = messages.length === 1 ? messages[0]!.title : `${messages.length} notifications from ${workspaceName}`;
  const text = messages.map(m => [m.title, m.body, m.url].filter(Boolean).join('\n')).join('\n\n');
  const items = messages.map((m) => {
    const title = m.url ? `<a href="${escapeHtml(m.url)}" style="color:#0b1020;font-weight:600;text-decoration:none">${escapeHtml(m.title)}</a>` : `<span style="font-weight:600">${escapeHtml(m.title)}</span>`;
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">${title}${m.body ? `<div style="color:#555;font-size:14px;margin-top:2px">${escapeHtml(m.body)}</div>` : ''}</td></tr>`;
  }).join('');
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0b1020;max-width:560px"><p>From <strong>${escapeHtml(workspaceName)}</strong>:</p><table style="width:100%;border-collapse:collapse">${items}</table></div>`;
  return { subject, text, html };
}

/**
 * The per-channel state of some notifications, for the list and the API.
 * @param notificationIds - The notifications.
 */
export async function deliveriesOf(notificationIds: readonly number[]): Promise<Map<number, Array<{ channel: string; status: string; detail: string | null; attempts: number; sentAt: string | null }>>> {
  const out = new Map<number, Array<{ channel: string; status: string; detail: string | null; attempts: number; sentAt: string | null }>>();
  if (notificationIds.length === 0) {
    return out;
  }
  const rows = await db
    .select()
    .from(notificationDeliverySchema)
    .where(inArray(notificationDeliverySchema.notificationId, [...notificationIds]))
    .orderBy(asc(notificationDeliverySchema.id));
  for (const r of rows) {
    const list = out.get(r.notificationId) ?? [];
    list.push({ channel: r.channel, status: r.status, detail: r.detail, attempts: r.attempts, sentAt: r.sentAt?.toISOString() ?? null });
    out.set(r.notificationId, list);
  }
  return out;
}
