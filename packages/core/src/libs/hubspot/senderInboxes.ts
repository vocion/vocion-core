/**
 * Which inbox an enrollment sends from: the sender as a user plus the inboxes
 * that user's sequences may send through, each new one on a warm-up ramp.
 *
 * A new sending domain that goes from nothing to a full day's volume gets
 * flagged, so new inboxes start at a few new enrollments a day and build over
 * three or four weeks. The platform decides the inbox
 * at Enroll, from config and the day's counts on the server clock. The model
 * never picks it: a cap worked out by a model drifts, and a draft is the same
 * whichever inbox sends it (no sign-off; HubSpot appends the signature).
 *
 * An inbox is connected under a HubSpot user, and an enrollment runs as that
 * user: it is the `userId` HubSpot checks the inbox against. That is usually
 * the sender, but an inbox a colleague connected (a marketing lead setting up
 * warm-up domains, say) runs as that colleague, and HubSpot then makes them
 * the owner of the sequence's tasks and of an unowned contact. `hubspotUser` names that user; the contacts sync hands both back
 * to the sender (`relayOwnership.ts`).
 *
 * Pure: counts come in, a pick goes out. Reading the counts is
 * `services/personalization/senderLedger.ts`.
 */

import { z } from 'zod';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const senderInboxSchema = z.object({
  /** The from-address. */
  email: z.string().email(),
  /** The HubSpot user the inbox is connected under, when it is not the sender's own. */
  hubspotUser: z.string().email().optional(),
  /**
   * A ramp: new enrollments a day for week 1, week 2, ... counted from
   * `start` in the sender's timezone. Past the last week the last value holds.
   */
  warmup: z.object({ start: isoDay, perDay: z.array(z.number().int().nonnegative()).min(1) }).optional(),
  /** A flat daily cap, on top of any ramp (the lower wins). */
  dailyCap: z.number().int().nonnegative().optional(),
  /** Takes nothing while true. */
  paused: z.boolean().default(false),
});
export type SenderInbox = z.infer<typeof senderInboxSchema>;

export const senderConfigSchema = z.object({
  /** The sender: whose sequence library the drafts read, and who owns the contact and the tasks. */
  user: z.string().email(),
  /** What "today" means for a daily cap. */
  timezone: z.string().default('America/Los_Angeles'),
  inboxes: z.array(senderInboxSchema).min(1),
});
export type SenderConfig = z.infer<typeof senderConfigSchema>;

/**
 * The sender config off the contacts source's raw config. `sender` wins;
 * a bare `defaultSender` reads as that user sending from their own inbox.
 * Null when neither is set (Enroll then uses the card's sender).
 * @param raw - The source's `configJson`.
 * @param raw.sender
 * @param raw.defaultSender
 */
export function senderConfigOf(raw: { sender?: unknown; defaultSender?: unknown } | null | undefined): SenderConfig | null {
  if (raw?.sender) {
    const parsed = senderConfigSchema.safeParse(raw.sender);
    if (parsed.success) {
      return parsed.data;
    }
    throw new Error(`The contacts source's sender config is invalid: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  if (typeof raw?.defaultSender === 'string' && raw.defaultSender) {
    return senderConfigSchema.parse({ user: raw.defaultSender, inboxes: [{ email: raw.defaultSender }] });
  }
  return null;
}

/**
 * The calendar day `now` falls on in `timezone`, as YYYY-MM-DD.
 * @param now
 * @param timezone - IANA name.
 */
export function localDay(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The UTC instants a local day starts and ends at, DST included.
 * @param day - YYYY-MM-DD.
 * @param timezone - IANA name.
 */
export function dayBounds(day: string, timezone: string): { start: Date; end: Date } {
  const midnight = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
    // Guess midnight UTC, then correct by the zone's offset at that guess,
    // twice, which settles across a DST change.
    let t = Date.UTC(y, m - 1, dd);
    for (let i = 0; i < 2; i += 1) {
      t = Date.UTC(y, m - 1, dd) - offsetMs(new Date(t), timezone);
    }
    return new Date(t);
  };
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start: midnight(day), end: midnight(next) };
}

/**
 * The zone's UTC offset at an instant, in ms (positive east of UTC).
 * @param at
 * @param timezone
 */
function offsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(at);
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Whole days from `from` to `to`, both YYYY-MM-DD.
 * @param from
 * @param to
 */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Where an inbox is on its ramp on `day`: the week (1-based) and the cap, or
 * null for an inbox with no ramp and no cap (it takes whatever comes).
 * A ramp that has not started yet caps at zero.
 * @param inbox
 * @param day - YYYY-MM-DD in the sender's timezone.
 */
export function capFor(inbox: SenderInbox, day: string): { cap: number; week: number | null } | null {
  let cap: number | null = null;
  let week: number | null = null;
  if (inbox.warmup) {
    const elapsed = daysBetween(inbox.warmup.start, day);
    if (elapsed < 0) {
      cap = 0;
      week = 0;
    } else {
      week = Math.floor(elapsed / 7) + 1;
      cap = inbox.warmup.perDay[Math.min(week, inbox.warmup.perDay.length) - 1]!;
    }
  }
  if (inbox.dailyCap !== undefined) {
    cap = cap === null ? inbox.dailyCap : Math.min(cap, inbox.dailyCap);
  }
  return cap === null ? null : { cap, week };
}

export type InboxPick
  = | {
    ok: true;
    inbox: SenderInbox;
    /** Who the enrollment runs as. */
    hubspotUser: string;
    reason: 'continuity' | 'warmup' | 'established';
    usedToday: number;
    /** Null for an uncapped inbox. */
    capToday: number | null;
    week: number | null;
  }
  | { ok: false; message: string };

/**
 * The inbox this enrollment sends from.
 *
 *   1. The inbox this contact was enrolled from before, while it has room:
 *      a lead who heard from one address keeps hearing from it.
 *   2. A warm-up inbox with room left today, the most room first, so the
 *      ramps are filled before anything else takes volume.
 *   3. An inbox without a ramp, in config order, while it has room.
 *   4. Nothing has room: refuse, naming each inbox's count, so the card
 *      stays pending and is enrolled tomorrow.
 * @param cfg
 * @param state
 * @param state.day - Today in `cfg.timezone`, YYYY-MM-DD.
 * @param state.counts - Enrollments already sent from each inbox today, by lowercased email.
 * @param state.previousInbox - The inbox this contact was last enrolled from, if any.
 */
export function pickInbox(
  cfg: SenderConfig,
  state: { day: string; counts: Record<string, number>; previousInbox?: string | null },
): InboxPick {
  const rows = cfg.inboxes.map((inbox, order) => {
    const used = state.counts[inbox.email.toLowerCase()] ?? 0;
    const capped = capFor(inbox, state.day);
    const room = inbox.paused ? 0 : capped === null ? Number.POSITIVE_INFINITY : Math.max(0, capped.cap - used);
    return { inbox, order, used, cap: capped?.cap ?? null, week: capped?.week ?? null, room };
  });
  const take = (row: (typeof rows)[number], reason: 'continuity' | 'warmup' | 'established'): InboxPick => ({
    ok: true,
    inbox: row.inbox,
    hubspotUser: row.inbox.hubspotUser ?? cfg.user,
    reason,
    usedToday: row.used,
    capToday: row.cap,
    week: row.week,
  });

  const previous = state.previousInbox?.toLowerCase();
  const kept = previous ? rows.find(r => r.inbox.email.toLowerCase() === previous && r.room > 0) : undefined;
  if (kept) {
    return take(kept, 'continuity');
  }
  const warm = rows
    .filter(r => r.inbox.warmup && r.room > 0)
    .sort((a, b) => b.room - a.room || a.order - b.order)[0];
  if (warm) {
    return take(warm, 'warmup');
  }
  const established = rows.find(r => !r.inbox.warmup && r.room > 0);
  if (established) {
    return take(established, 'established');
  }
  const detail = rows
    .map(r => (r.inbox.paused ? `${r.inbox.email} paused` : `${r.inbox.email} ${r.used} of ${r.cap ?? 'unlimited'}`))
    .join(', ');
  return { ok: false, message: `Today's sending budget is used: ${detail}. Enroll again tomorrow.` };
}
