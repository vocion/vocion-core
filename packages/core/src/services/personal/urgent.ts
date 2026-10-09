/**
 * What is urgent for a person, pushed to them (docs/guides/push-to-you.md):
 *
 *   - **An approval blocking a run.** A decision on them whose kind is an
 *     approval holds its run until they decide it. The rhythm sweep reads the
 *     person's queue across their workspaces every five minutes and pushes
 *     each one that arrived since it last looked (`urgent_seen_at`), at most
 *     three a sweep, linking to the row in its workspace.
 *   - **A broken connection.** When one of the person's own connections stops
 *     working — the grant was revoked or expired, so only reconnecting fixes
 *     it — the call that found out reports it once a day, linking to Personal
 *     → Connectors.
 *
 * Only for people who chose a channel (`push_channels`); everyone else sees
 * these in the app as before. Inside quiet hours the sweep does not move its
 * mark, so what arrived then is pushed when they end.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { personalConnectionFor } from '@/libs/personal/connections';
import { personalRhythmSchema, tenantAccountSchema } from '@/models/Schema';
import { pushToPerson, quietNow } from './push';

/** At most this many approvals pushed to one person in one sweep; the rest are in the app. */
export const URGENT_PER_SWEEP = 3;

/**
 * The sweep's urgent half: new approvals on each person who pushes.
 * @param now - The clock.
 * @param push - The push (a seam for tests).
 */
export async function sweepUrgent(now: Date = new Date(), push: typeof pushToPerson = pushToPerson): Promise<{ pushed: number }> {
  const rows = await db
    .select({ userId: personalRhythmSchema.userId, accountId: personalRhythmSchema.accountId, seen: personalRhythmSchema.urgentSeenAt, quietStart: personalRhythmSchema.quietStart, quietEnd: personalRhythmSchema.quietEnd, timeZone: personalRhythmSchema.timeZone, accountSlug: tenantAccountSchema.slug })
    .from(personalRhythmSchema)
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, personalRhythmSchema.accountId))
    .where(sql`jsonb_array_length(${personalRhythmSchema.pushChannels}) > 0`)
    .limit(500);
  const { listInboxForUser } = await import('@/services/inbox/acrossWorkspaces');
  let pushed = 0;
  for (const row of rows) {
    if (await quietNow(row, now)) {
      continue;
    }
    if (!row.seen) {
      // Push just turned on: what was already waiting is in the app; start from now.
      await mark(row.userId, row.accountId, now);
      continue;
    }
    try {
      const inbox = await listInboxForUser(row.userId, { accountId: row.accountId });
      const fresh = inbox.items
        .filter(i => i.yours && i.kind === 'approval' && i.at.getTime() > row.seen!.getTime())
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, URGENT_PER_SWEEP);
      for (const item of fresh) {
        const out = await push({
          userId: row.userId,
          accountId: row.accountId,
          kind: 'urgent',
          key: `approval:${item.workspace.id}:${item.key}`,
          title: `Waiting on you: ${item.title}`.slice(0, 200),
          body: `An approval in ${item.workspace.name} is holding its run until you decide.`,
          path: new URL(item.link, 'http://x').pathname + new URL(item.link, 'http://x').search,
          workspaceSlug: item.workspace.slug,
          accountSlug: row.accountSlug,
        }, { now });
        pushed += out.pushed ? 1 : 0;
      }
      await mark(row.userId, row.accountId, now);
    } catch (error) {
      logger.warn('urgent sweep: one person could not be read; the next sweep tries again', { errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }
  return { pushed };
}

async function mark(userId: string, accountId: string, at: Date): Promise<void> {
  await db.update(personalRhythmSchema).set({ urgentSeenAt: at }).where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, accountId)));
}

/**
 * Tell the person, once a day, that one of their own connections broke.
 * Never throws: the call that found out still answers with its own sentence.
 * @param input - Whose connection, and which.
 * @param input.orgId - Their Personal workspace.
 * @param input.userId - The person.
 * @param input.connector - The connection's connector slug.
 * @param input.now - The clock.
 */
export async function reportBrokenConnection(input: { orgId: string; userId: string; connector: string; now?: Date }): Promise<void> {
  try {
    const now = input.now ?? new Date();
    const { projectSchema } = await import('@/models/Schema');
    const [home] = await db
      .select({ slug: projectSchema.slug, accountId: projectSchema.accountId, accountSlug: tenantAccountSchema.slug })
      .from(projectSchema)
      .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, projectSchema.accountId))
      .where(eq(projectSchema.id, input.orgId))
      .limit(1);
    if (!home) {
      return;
    }
    const label = personalConnectionFor(input.connector)?.label ?? input.connector;
    await pushToPerson({
      userId: input.userId,
      accountId: home.accountId,
      kind: 'urgent',
      key: `broken:${input.connector}:${now.toISOString().slice(0, 10)}`,
      title: `${label} stopped working`,
      body: `Your assistant can no longer read your ${label}. Connect it again to pick up where it left off.`,
      path: '/dashboard/connectors',
      workspaceSlug: home.slug,
      accountSlug: home.accountSlug,
    }, { now });
  } catch (error) {
    logger.warn('could not report a broken connection', { errorName: error instanceof Error ? error.name : 'unknown' });
  }
}
