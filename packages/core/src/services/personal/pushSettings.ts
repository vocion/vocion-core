/**
 * A person's push settings, read and changed without the senders.
 *
 * Kept apart from `services/personal/push.ts` for the build's sake: push.ts
 * reaches the in-app notifier, and through it the whole server, so the
 * sign-in-free stop link (`app/api/personal/push/stop/route.ts`), which only
 * turns one channel off, compiled the whole server into its route. v5.25.0's
 * image build was the first one the deploy runner could not finish
 * (`scripts/check-route-graph.ts`).
 */

import type { PushChannel } from '@/libs/personal/stopLink';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { personalRhythmSchema } from '@/models/Schema';

/**
 * The person's push settings in this Org, or null before they set any.
 * @param userId - The person.
 * @param accountId - Their Org.
 */
export async function pushSettingsOf(userId: string, accountId: string) {
  const [row] = await db
    .select({ channels: personalRhythmSchema.pushChannels, mode: personalRhythmSchema.pushMode, quietStart: personalRhythmSchema.quietStart, quietEnd: personalRhythmSchema.quietEnd, timeZone: personalRhythmSchema.timeZone })
    .from(personalRhythmSchema)
    .where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, accountId)))
    .limit(1);
  return row ?? null;
}

/**
 * Turn one channel off for one person (the one-tap stop link).
 * @param userId - The person.
 * @param accountId - Their Org.
 * @param channel - The channel to stop.
 */
export async function stopChannel(userId: string, accountId: string, channel: PushChannel): Promise<void> {
  const settings = await pushSettingsOf(userId, accountId);
  if (!settings) {
    return;
  }
  await db.update(personalRhythmSchema)
    .set({ pushChannels: settings.channels.filter(c => c !== channel) })
    .where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, accountId)));
}
