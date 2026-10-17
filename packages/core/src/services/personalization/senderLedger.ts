/**
 * What each sending inbox has done, read from the enrollments themselves.
 *
 * Every Enroll's run result records the inbox it sent from (`senderEmail`)
 * and the run its `executedAt`, so a day's count per inbox is a query over
 * the done `personalization.enroll` runs: no separate ledger to keep in step.
 */

import type { SenderConfig } from '@/libs/hubspot/senderInboxes';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { capFor, dayBounds, localDay, pickInbox } from '@/libs/hubspot/senderInboxes';
import { actionRunSchema } from '@/models/Schema';

const ENROLL = 'personalization.enroll';

/**
 * Enrollments sent from each inbox between two instants, by lowercased email.
 * @param orgId
 * @param start
 * @param end
 */
export async function enrollmentsByInbox(orgId: string, start: Date, end: Date): Promise<Record<string, number>> {
  const inbox = sql<string>`lower(${actionRunSchema.result}->>'senderEmail')`;
  const rows = await db
    .select({ inbox, n: sql<number>`count(*)::int` })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, ENROLL),
      eq(actionRunSchema.status, 'done'),
      gte(actionRunSchema.executedAt, start),
      lt(actionRunSchema.executedAt, end),
    ))
    .groupBy(inbox);
  return Object.fromEntries(rows.filter(r => r.inbox).map(r => [r.inbox, Number(r.n)]));
}

/**
 * The inbox this contact was last enrolled from, if it ever was.
 * @param orgId
 * @param contactRef
 */
export async function previousInboxFor(orgId: string, contactRef: string): Promise<string | null> {
  const [row] = await db
    .select({ inbox: sql<string | null>`${actionRunSchema.result}->>'senderEmail'` })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, ENROLL),
      eq(actionRunSchema.status, 'done'),
      sql`${actionRunSchema.input}->>'contactRef' = ${contactRef}`,
    ))
    .orderBy(desc(actionRunSchema.executedAt))
    .limit(1);
  return row?.inbox ?? null;
}

/**
 * The pick for an enrollment happening now.
 * @param orgId
 * @param cfg
 * @param contactRef
 * @param now - The server clock.
 */
export async function pickInboxNow(orgId: string, cfg: SenderConfig, contactRef: string, now: Date = new Date()) {
  const day = localDay(now, cfg.timezone);
  const { start, end } = dayBounds(day, cfg.timezone);
  const [counts, previousInbox] = await Promise.all([
    enrollmentsByInbox(orgId, start, end),
    previousInboxFor(orgId, contactRef),
  ]);
  return pickInbox(cfg, { day, counts, previousInbox });
}

export type InboxStatus = {
  email: string;
  hubspotUser: string;
  paused: boolean;
  usedToday: number;
  /** Null for an uncapped inbox. */
  capToday: number | null;
  /** Ramp week (1-based), 0 before the ramp starts, null without a ramp. */
  week: number | null;
  /** Enrollments in the last 7 days, today included. */
  last7Days: number;
};

/**
 * Today's picture for the Sending inboxes panel.
 * @param orgId
 * @param cfg
 * @param now
 */
export async function inboxStatuses(orgId: string, cfg: SenderConfig, now: Date = new Date()): Promise<{ day: string; timezone: string; inboxes: InboxStatus[] }> {
  const day = localDay(now, cfg.timezone);
  const { start, end } = dayBounds(day, cfg.timezone);
  const weekStart = dayBounds(new Date(Date.parse(`${day}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), cfg.timezone).start;
  const [today, week] = await Promise.all([
    enrollmentsByInbox(orgId, start, end),
    enrollmentsByInbox(orgId, weekStart, end),
  ]);
  return {
    day,
    timezone: cfg.timezone,
    inboxes: cfg.inboxes.map((inbox) => {
      const key = inbox.email.toLowerCase();
      const capped = capFor(inbox, day);
      return {
        email: inbox.email,
        hubspotUser: inbox.hubspotUser ?? cfg.user,
        paused: inbox.paused,
        usedToday: today[key] ?? 0,
        capToday: capped?.cap ?? null,
        week: capped?.week ?? null,
        last7Days: week[key] ?? 0,
      };
    }),
  };
}
