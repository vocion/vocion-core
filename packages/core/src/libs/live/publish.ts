import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@/models/Schema';
import { db } from '@/libs/DB';
import { liveNoticeSchema } from '@/models/Schema';
import { parseTopic } from './topics';

/**
 * PUBLISH A CHANGE NOTICE to the workspace live stream (backlog 050).
 *
 * Most notices need no call: a row change on a record, a card, a worker or
 * agent run, an ask, an artifact or an event publishes itself by trigger
 * (migration 0155), inside the writer's transaction, from whichever process
 * wrote it. This is for everything else — a notification (backlog 048,
 * `liveTopic.notification(userId)`), or a change that is not a row on one of
 * those tables.
 *
 * It inserts into `live_notice`, whose trigger rings `pg_notify`; so, like
 * the triggers, it is delivered only if the transaction commits. Pass the
 * transaction when there is one. A notice carries no payload — the follower
 * re-reads — so never put what changed into `ref` or `kind`, only which thing
 * and how.
 *
 * Refuses a topic the stream does not publish (`parseTopic`), rather than
 * writing a notice nobody could ever follow.
 * @param notice - The notice.
 * @param notice.orgId - The workspace it belongs to; only that workspace hears it.
 * @param notice.topics - Where it is heard (`libs/live/topics.ts` `liveTopic`).
 * @param notice.ref - What changed, `<noun>:<id>`.
 * @param notice.kind - How: `created`, `changed`, `deleted`, or a type of your own.
 * @param tx - The transaction the change is written in, when there is one.
 * @returns The notice's id in the ring.
 */
export async function publish(
  notice: { orgId: string; topics: readonly string[]; ref: string; kind: string },
  tx?: Pick<NodePgDatabase<typeof schema>, 'insert'>,
): Promise<number> {
  const bad = notice.topics.filter(t => parseTopic(t) === null);
  if (bad.length > 0) {
    throw new Error(`live: not a topic the stream publishes: ${bad.join(', ')}`);
  }
  if (!notice.orgId || notice.topics.length === 0) {
    throw new Error('live: a notice needs a workspace and at least one topic');
  }
  const [row] = await (tx ?? db)
    .insert(liveNoticeSchema)
    .values({ orgId: notice.orgId, topics: [...new Set(notice.topics)], ref: notice.ref, kind: notice.kind })
    .returning({ id: liveNoticeSchema.id });
  return Number(row!.id);
}
