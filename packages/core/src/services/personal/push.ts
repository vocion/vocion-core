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
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { appBaseUrl } from '@/libs/links';
import { logger } from '@/libs/Logger';
import { stopToken } from '@/libs/personal/stopLink';
import { resolveTimeZone } from '@/libs/time/zone';
import { userSchema } from '@/models/Schema';
import { pushSettingsOf } from '@/services/personal/pushSettings';

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
  /**
   * A brief read aloud to carry with it (docs/guides/listen-to-your-brief.md),
   * when it has one ready: Slack gets the MP3 as a file, a text gets it as an
   * MMS, an email gets a Listen button.
   */
  audio?: { orgId: string; briefingId: number };
};

/** A brief's MP3, as each channel carries it. */
export type PushAudio = {
  bytes: Uint8Array;
  filename: string;
  title: string;
  durationMs: number;
  /** A public, signed, expiring URL of the MP3 (a text's attachment). */
  clipUrl: string;
};

/** An email attaches the MP3 under this size (2 MB, about four minutes): iOS Mail plays it inline, offline. */
export const EMAIL_AUDIO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * A duration as a person reads it: `2:14`.
 * @param ms - Milliseconds.
 */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The email a push sends: title, body, Open — and, with a brief's audio, a
 * "▶ Listen (2:14)" button to the brief's page, where the player is. Pure.
 * @param m - The message.
 * @param m.title - Title.
 * @param m.body - Body.
 * @param m.url - Where it opens.
 * @param m.stopUrl - The one-tap stop.
 * @param m.audio - The brief's audio, if any.
 */
export function pushEmail(m: { title: string; body: string; url: string; stopUrl: string; audio?: PushAudio }): { html: string; text: string; attachments?: Array<{ filename: string; content: Uint8Array; contentType: string }> } {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const listenUrl = m.audio ? `${m.url}${m.url.includes('?') ? '&' : '?'}listen=1` : null;
  const listen = m.audio && listenUrl
    ? `<p style="margin:0 0 14px"><a href="${esc(listenUrl)}" style="display:inline-block;background:#0b1020;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:999px">▶ Listen (${clock(m.audio.durationMs)})</a></p>`
    : '';
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0b1020;max-width:560px"><p style="font-weight:600;margin:0 0 6px">${esc(m.title)}</p><p style="color:#444;margin:0 0 14px">${esc(m.body)}</p>${listen}<p><a href="${esc(m.url)}" style="color:#0b1020;font-weight:600">Open in Vocion →</a></p><p style="color:#888;font-size:12px;margin-top:24px"><a href="${esc(m.stopUrl)}" style="color:#888">Stop these emails</a></p></div>`;
  const text = `${m.title}\n\n${m.body}\n\n${listenUrl && m.audio ? `Listen (${clock(m.audio.durationMs)}): ${listenUrl}\n\n` : ''}Open: ${m.url}\n\nStop these emails: ${m.stopUrl}`;
  const attach = m.audio && m.audio.bytes.byteLength <= EMAIL_AUDIO_MAX_BYTES;
  return { html, text, ...(attach ? { attachments: [{ filename: m.audio!.filename, content: m.audio!.bytes, contentType: 'audio/mpeg' }] } : {}) };
}

export type PushOutcome
  = | { pushed: true; channels: Array<{ channel: PushChannel; status: string }> }
    | { pushed: false; reason: 'already' | 'mode' | 'quiet' | 'rate_limited' | 'no_channels' };

/** What every channel is handed. */
export type PushMessage = { title: string; body: string; url: string; stopUrl: string; audio?: PushAudio };

/** The senders, a seam for tests. */
export type PushSenders = {
  slack: (to: { email: string }, message: PushMessage) => Promise<string>;
  sms: (to: { userId: string; orgId: string }, message: PushMessage) => Promise<string>;
  email: (to: { email: string; orgId: string }, message: PushMessage) => Promise<string>;
};

const defaultSenders: PushSenders = {
  async slack(to, m) {
    const { sendSlack, slackToken } = await import('@/libs/notifications/slack');
    const listen = m.audio ? `\n\n▶ Listen below (${clock(m.audio.durationMs)})` : '';
    const out = await sendSlack({ dmEmail: to.email }, { id: 0, kind: 'personal-push', title: m.title, body: `${m.body}${listen}\n\nStop these on Slack: ${m.stopUrl}`, url: m.url }, slackToken(), m.audio ? { file: { filename: m.audio.filename, title: m.audio.title, bytes: m.audio.bytes } } : {});
    return out.status;
  },
  async sms(to, m) {
    const { smsTargetFor } = await import('@/services/notifications/delivery');
    const { mmsMaxBytes, sendSmsNotification } = await import('@/libs/notifications/sms');
    const target = await smsTargetFor(to.orgId, to.userId);
    if ('error' in target) {
      return 'failed';
    }
    const media = m.audio && m.audio.bytes.byteLength <= mmsMaxBytes() ? { url: m.audio.clipUrl } : undefined;
    const listen = m.audio ? `Listen (${clock(m.audio.durationMs)}) at the link. ` : '';
    const out = await sendSmsNotification(target, { id: 0, kind: 'personal-push', title: m.title, body: `${listen}Stop texts: ${m.stopUrl}`, url: m.url }, undefined, media);
    return out.status;
  },
  async email(to, m) {
    const { mailEnabled, sendMail } = await import('@/libs/mail');
    if (!mailEnabled()) {
      return 'not_configured';
    }
    const { html, text, attachments } = pushEmail(m);
    const sent = await sendMail({
      to: to.email,
      subject: m.title,
      text,
      html,
      ...(attachments ? { attachments } : {}),
      tags: { kind: 'personal-push' },
      // One-click unsubscribe (RFC 8058): mail clients show their own "Unsubscribe".
      headers: { 'List-Unsubscribe': `<${m.stopUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      brand: { orgId: to.orgId },
    });
    return 'skipped' in sent && sent.skipped ? 'not_configured' : 'sent';
  },
};

/**
 * A ready brief's MP3 and its signed public URL, or null when it has none.
 * @param ref - Which brief.
 * @param ref.orgId - Its workspace.
 * @param ref.briefingId - The brief.
 * @param base - The app's absolute URL.
 * @param now - The clock.
 */
async function pushAudioOf(ref: { orgId: string; briefingId: number }, base: string, now: Date): Promise<PushAudio | null> {
  const { readBriefAudio } = await import('@/services/briefings/audio/audio');
  const file = await readBriefAudio(ref.orgId, ref.briefingId);
  if (!file) {
    return null;
  }
  const { CLIP_TTL_MS, clipPath } = await import('@/libs/briefings/listenLink');
  return { ...file, clipUrl: `${base}${clipPath({ orgId: ref.orgId, briefingId: ref.briefingId, exp: now.getTime() + CLIP_TTL_MS })}` };
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
  const settings = await pushSettingsOf(item.userId, item.accountId);
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
  const audio = item.audio ? await pushAudioOf(item.audio, base, now) : null;
  const out: Array<{ channel: PushChannel; status: string }> = [];
  for (const channel of channels) {
    const stopUrl = `${base}/api/personal/push/stop?t=${encodeURIComponent(stopToken({ userId: item.userId, accountId: item.accountId, channel }))}`;
    const message: PushMessage = { title: item.title, body: item.body, url, stopUrl, ...(audio ? { audio } : {}) };
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
