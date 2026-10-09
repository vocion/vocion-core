/**
 * Push to the person: their morning brief and what is urgent, beyond the app
 * — a Slack DM, a text, an email — each with a deep link that opens the app on
 * that item and a one-tap "stop these" (docs/guides/push-to-you.md).
 *
 * Every push is also an in-app notification in the person's Personal
 * workspace (the bell), which is the once-only record: a push whose key was
 * already said is not said again on any channel.
 *
 * The person decides, under Notification settings → Your day:
 *   - the channels (`personal_rhythm.push_channels`; none by default — in
 *     the app only until they choose);
 *   - urgent only, or the brief and urgent (`push_mode`);
 *   - quiet hours, in their zone (`quiet_start` / `quiet_end`). Inside them
 *     nothing leaves the app; an urgent item waits and goes when they end.
 *
 * The senders are the ones notifications already use (`sendSlack`,
 * `sendSmsNotification`, `sendMail`). One rate limit bounds them per person
 * (`personal-push:user`, six an hour): past it, the item still lands in the app.
 */

import type { PushChannel } from '@/libs/personal/stopLink';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { appBaseUrl } from '@/libs/links';
import { logger } from '@/libs/Logger';
import { stopToken } from '@/libs/personal/stopLink';
import { resolveTimeZone } from '@/libs/time/zone';
import { personalRhythmSchema, userSchema } from '@/models/Schema';

/** What one push says. */
export type PushItem = {
  userId: string;
  accountId: string;
  /** `brief` pushes only in `brief_and_urgent` mode; `urgent` always. */
  kind: 'brief' | 'urgent';
  /** Once-only: the same key is never pushed twice. */
  key: string;
  title: string;
  body: string;
  /** In-app path to open on the item (`/dashboard/chat?conversation=…`), workspace-prefixed or not. */
  path: string;
  /** The workspace the path belongs to, for its `/w/<slug>` prefix. */
  workspaceSlug: string;
  accountSlug?: string;
};

export type PushOutcome
  = | { pushed: true; channels: Array<{ channel: PushChannel; status: string }> }
    | { pushed: false; reason: 'already' | 'mode' | 'quiet' | 'rate_limited' | 'no_channels' };

/** The senders, a seam for tests. */
export type PushSenders = {
  slack: (to: { email: string }, message: { title: string; body: string; url: string; stopUrl: string }) => Promise<string>;
  sms: (to: { userId: string; orgId: string }, message: { title: string; body: string; url: string; stopUrl: string }) => Promise<string>;
  email: (to: { email: string; orgId: string }, message: { title: string; body: string; url: string; stopUrl: string }) => Promise<string>;
};

const defaultSenders: PushSenders = {
  async slack(to, m) {
    const { sendSlack, slackToken } = await import('@/libs/notifications/slack');
    const out = await sendSlack({ dmEmail: to.email }, { id: 0, kind: 'personal-push', title: m.title, body: `${m.body}\n\nStop these on Slack: ${m.stopUrl}`, url: m.url }, slackToken());
    return out.status;
  },
  async sms(to, m) {
    const { smsTargetFor } = await import('@/services/notifications/delivery');
    const { sendSmsNotification } = await import('@/libs/notifications/sms');
    const target = await smsTargetFor(to.orgId, to.userId);
    if ('error' in target) {
      return 'failed';
    }
    const out = await sendSmsNotification(target, { id: 0, kind: 'personal-push', title: m.title, body: `Stop texts: ${m.stopUrl}`, url: m.url });
    return out.status;
  },
  async email(to, m) {
    const { mailEnabled, sendMail } = await import('@/libs/mail');
    if (!mailEnabled()) {
      return 'not_configured';
    }
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0b1020;max-width:560px"><p style="font-weight:600;margin:0 0 6px">${esc(m.title)}</p><p style="color:#444;margin:0 0 14px">${esc(m.body)}</p><p><a href="${esc(m.url)}" style="color:#0b1020;font-weight:600">Open in Vocion →</a></p><p style="color:#888;font-size:12px;margin-top:24px"><a href="${esc(m.stopUrl)}" style="color:#888">Stop these emails</a></p></div>`;
    const sent = await sendMail({
      to: to.email,
      subject: m.title,
      text: `${m.title}\n\n${m.body}\n\nOpen: ${m.url}\n\nStop these emails: ${m.stopUrl}`,
      html,
      tags: { kind: 'personal-push' },
      // One-click unsubscribe (RFC 8058): mail clients show their own "Unsubscribe".
      headers: { 'List-Unsubscribe': `<${m.stopUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      brand: { orgId: to.orgId },
    });
    return 'skipped' in sent && sent.skipped ? 'not_configured' : 'sent';
  },
};

/**
 * The person's push settings, or null when they have no rhythm row yet.
 * @param userId - The person.
 * @param accountId - Their Org.
 */
async function settingsOf(userId: string, accountId: string) {
  const [row] = await db
    .select({ channels: personalRhythmSchema.pushChannels, mode: personalRhythmSchema.pushMode, quietStart: personalRhythmSchema.quietStart, quietEnd: personalRhythmSchema.quietEnd, timeZone: personalRhythmSchema.timeZone })
    .from(personalRhythmSchema)
    .where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, accountId)))
    .limit(1);
  return row ?? null;
}

/**
 * When the person's quiet hours end, if they are inside them now.
 * @param s - Their settings.
 * @param s.quietStart - Start, `HH:MM`.
 * @param s.quietEnd - End, `HH:MM`.
 * @param s.timeZone - Their zone.
 * @param now - The clock.
 */
export async function quietNow(s: { quietStart: string | null; quietEnd: string | null; timeZone: string | null }, now: Date): Promise<Date | null> {
  if (!s.quietStart || !s.quietEnd) {
    return null;
  }
  const { quietUntil } = await import('@/libs/notifications/quietHours');
  return quietUntil(now, { start: s.quietStart, end: s.quietEnd, timeZone: resolveTimeZone(s.timeZone, process.env.VOCION_TIMEZONE) });
}

/**
 * Push one item to the person: in the app always, and on their chosen
 * channels unless the mode, quiet hours or the rate limit say not now.
 * @param item - What to push.
 * @param opts - The clock and the senders (seams for tests).
 * @param opts.now - The clock.
 * @param opts.senders - The channel senders.
 */
export async function pushToPerson(item: PushItem, opts: { now?: Date; senders?: PushSenders } = {}): Promise<PushOutcome> {
  const now = opts.now ?? new Date();
  const senders = opts.senders ?? defaultSenders;
  const settings = await settingsOf(item.userId, item.accountId);
  const channels = (settings?.channels ?? []).filter((c): c is PushChannel => c === 'slack' || c === 'sms' || c === 'email');
  if (item.kind === 'brief' && settings?.mode === 'urgent') {
    return { pushed: false, reason: 'mode' };
  }
  if (settings && await quietNow(settings, now)) {
    return { pushed: false, reason: 'quiet' };
  }
  const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
  const home = await ensurePersonalProject(item.userId, item.accountId);
  const { workspaceUrl } = await import('@/libs/links');
  const path = item.path.startsWith('/w/') ? item.path : workspaceUrl(item.workspaceSlug, item.path, item.accountSlug ? { accountSlug: item.accountSlug } : {});
  // The in-app record is the once-only key: a push already said is not said again.
  const { notify } = await import('@/services/notifications/notify');
  const noted = await notify({ orgId: home.id, kind: item.kind === 'brief' ? 'personal-brief' : 'personal-urgent', userIds: [item.userId], title: item.title, body: item.body, link: path, dedupeKey: `personal-push:${item.key}` }, { now, deliver: 'none' });
  if (noted.created.length === 0) {
    return { pushed: false, reason: 'already' };
  }
  if (channels.length === 0) {
    return { pushed: false, reason: 'no_channels' };
  }
  const { hit } = await import('@/libs/rateLimit');
  const { RATE_LIMITS } = await import('@/libs/rateLimit/policies');
  const verdict = await hit(RATE_LIMITS.personalPushPerUser, `${item.userId}:${item.accountId}`, now);
  if (!verdict.allowed) {
    return { pushed: false, reason: 'rate_limited' };
  }
  const base = appBaseUrl();
  const url = `${base}${path}`;
  const [user] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, item.userId)).limit(1);
  const out: Array<{ channel: PushChannel; status: string }> = [];
  for (const channel of channels) {
    const stopUrl = `${base}/api/personal/push/stop?t=${encodeURIComponent(stopToken({ userId: item.userId, accountId: item.accountId, channel }))}`;
    const message = { title: item.title, body: item.body, url, stopUrl };
    try {
      const status = channel === 'sms'
        ? await senders.sms({ userId: item.userId, orgId: home.id }, message)
        : user?.email
          ? await senders[channel]({ email: user.email, orgId: home.id }, message)
          : 'failed';
      out.push({ channel, status });
    } catch (error) {
      logger.warn('personal push: a channel failed; the item is in the app', { channel, errorName: error instanceof Error ? error.name : 'unknown' });
      out.push({ channel, status: 'failed' });
    }
  }
  return { pushed: true, channels: out };
}

/**
 * Turn one channel off for one person: what the one-tap stop link does.
 * @param userId - The person.
 * @param accountId - Their Org.
 * @param channel - The channel.
 */
export async function stopChannel(userId: string, accountId: string, channel: PushChannel): Promise<void> {
  const settings = await settingsOf(userId, accountId);
  if (!settings) {
    return;
  }
  await db.update(personalRhythmSchema)
    .set({ pushChannels: settings.channels.filter(c => c !== channel) })
    .where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, accountId)));
}

/**
 * Which channels can reach this person from this server, and why not where
 * one cannot — said beside each switch, so a channel never looks on and
 * reaches nobody.
 * @param userId - The person.
 */
export async function pushChannelsAvailable(userId: string): Promise<Record<PushChannel, string | null>> {
  const [{ slackToken }, { smsConfigured }, { mailEnabled }] = await Promise.all([import('@/libs/notifications/slack'), import('@/libs/notifications/sms'), import('@/libs/mail')]);
  const [user] = await db.select({ phone: userSchema.phone }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  return {
    slack: slackToken() ? null : 'Slack is not set up on this server.',
    sms: !smsConfigured() ? 'Texting is not set up on this server.' : !user?.phone ? 'Add your mobile number on your profile first.' : null,
    email: mailEnabled() ? null : 'Email is not set up on this server.',
  };
}
