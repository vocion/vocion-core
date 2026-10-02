import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { CHANNEL_LABELS } from '@/libs/notifications/types';
import { notificationRuleSchema, notificationSchema } from '@/models/Schema';
import { deliveriesOf } from './delivery';

/**
 * The reads a person's notifications need — the bell's count, the list page,
 * the API and MCP. One shape everywhere (`NotificationView`).
 */

export type NotificationView = {
  id: number;
  kind: string;
  /** The kind's label as declared ("Needs a person"), or the kind itself. */
  kindLabel: string;
  title: string;
  body: string | null;
  link: string | null;
  record: { type: string; id: string } | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
  deliveries: Array<{ channel: string; channelLabel: string; status: string; detail: string | null; attempts: number; sentAt: string | null }>;
};

/**
 * How many of this person's notifications in this workspace are unread.
 * @param userId - The person.
 * @param orgId - The workspace.
 */
export async function unreadCount(userId: string, orgId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notificationSchema)
    .where(and(eq(notificationSchema.userId, userId), eq(notificationSchema.orgId, orgId), isNull(notificationSchema.readAt)));
  return Number(row?.n ?? 0);
}

/**
 * This person's notifications in this workspace, newest first.
 * @param userId - The person.
 * @param orgId - The workspace.
 * @param opts - Paging and filter.
 * @param opts.limit - Page size.
 * @param opts.before - Only ids below this (the next page).
 * @param opts.unread - Only unread.
 */
export async function listNotifications(userId: string, orgId: string, opts: { limit?: number; before?: number; unread?: boolean } = {}): Promise<{ items: NotificationView[]; unread: number; nextBefore: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const rows = await db
    .select()
    .from(notificationSchema)
    .where(and(
      eq(notificationSchema.userId, userId),
      eq(notificationSchema.orgId, orgId),
      opts.unread ? isNull(notificationSchema.readAt) : undefined,
      opts.before ? lt(notificationSchema.id, opts.before) : undefined,
    ))
    .orderBy(desc(notificationSchema.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const [deliveries, labels, unread] = await Promise.all([
    deliveriesOf(page.map(r => r.id)),
    kindLabels(orgId),
    unreadCount(userId, orgId),
  ]);
  return {
    items: page.map(r => ({
      id: r.id,
      kind: r.kind,
      kindLabel: labels.get(r.kind) ?? r.kind,
      title: r.title,
      body: r.body,
      link: r.link,
      record: r.recordType && r.recordId ? { type: r.recordType, id: r.recordId } : null,
      read: r.readAt !== null,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      deliveries: (deliveries.get(r.id) ?? []).map(d => ({ ...d, channelLabel: CHANNEL_LABELS[d.channel as keyof typeof CHANNEL_LABELS] ?? d.channel })),
    })),
    unread,
    nextBefore: rows.length > limit ? page[page.length - 1]!.id : null,
  };
}

/** A declared kind, for the settings page: what it is, where it came from, when it last fired. */
export type KindView = {
  kind: string;
  label: string;
  description: string | null;
  event: string;
  source: string;
  status: string;
  lastFiredAt: string | null;
  lastNote: string | null;
};

/**
 * The notification kinds this workspace declares (active first).
 * @param orgId - The workspace.
 */
export async function listKinds(orgId: string): Promise<KindView[]> {
  const rows = await db.select().from(notificationRuleSchema).where(eq(notificationRuleSchema.orgId, orgId));
  return rows
    .sort((a, b) => (a.status === b.status ? a.label.localeCompare(b.label) : a.status === 'active' ? -1 : 1))
    .map(r => ({ kind: r.kind, label: r.label, description: r.description, event: r.event, source: r.source, status: r.status, lastFiredAt: r.lastFiredAt?.toISOString() ?? null, lastNote: r.lastNote }));
}

async function kindLabels(orgId: string): Promise<Map<string, string>> {
  const rows = await db.select({ kind: notificationRuleSchema.kind, label: notificationRuleSchema.label }).from(notificationRuleSchema).where(eq(notificationRuleSchema.orgId, orgId));
  return new Map(rows.map(r => [r.kind, r.label]));
}
