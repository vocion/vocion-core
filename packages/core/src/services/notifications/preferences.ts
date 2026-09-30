import type { PreferenceChange } from '@/libs/notifications/preferences';
import type { NotificationPreferences, SlackTarget } from '@/libs/notifications/types';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { mergePreferences } from '@/libs/notifications/preferences';
import { DEFAULT_PREFERENCES } from '@/libs/notifications/types';
import { notificationPreferenceSchema } from '@/models/Schema';

/**
 * One person's notification settings in one workspace. No row is every
 * default (`CHANNEL_DEFAULTS`).
 * @param userId - The person.
 * @param orgId - The workspace.
 */
export async function getPreferences(userId: string, orgId: string): Promise<NotificationPreferences> {
  const [row] = await db
    .select()
    .from(notificationPreferenceSchema)
    .where(and(eq(notificationPreferenceSchema.userId, userId), eq(notificationPreferenceSchema.orgId, orgId)))
    .limit(1);
  if (!row) {
    return { ...DEFAULT_PREFERENCES, channels: {} };
  }
  return { channels: row.channels ?? {}, quietHours: row.quietHours ?? null, slackTarget: (row.slackTarget === 'channel' ? 'channel' : 'dm') as SlackTarget };
}

/**
 * Change a person's settings; only what the change names moves.
 * @param userId - The person.
 * @param orgId - The workspace.
 * @param change - What changes (`parsePreferenceChange`).
 */
export async function setPreferences(userId: string, orgId: string, change: PreferenceChange): Promise<NotificationPreferences> {
  const next = mergePreferences(await getPreferences(userId, orgId), change);
  await db
    .insert(notificationPreferenceSchema)
    .values({ userId, orgId, channels: next.channels, quietHours: next.quietHours, slackTarget: next.slackTarget, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [notificationPreferenceSchema.userId, notificationPreferenceSchema.orgId],
      set: { channels: next.channels, quietHours: next.quietHours, slackTarget: next.slackTarget, updatedAt: new Date() },
    });
  return next;
}
