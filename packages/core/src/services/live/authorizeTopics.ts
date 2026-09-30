import type { LiveTopic } from '@/libs/live/topics';
import type { ShareAudience } from '@/libs/share/audience';
import type { ApiCaller } from '@/services/writeApi';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { parseTopic } from '@/libs/live/topics';
import { canOpenArtifact } from '@/libs/share/audience';
import { actionRunSchema, artifactSchema, askSchema, businessObjectSchema, missionRunSchema, workerRunSchema } from '@/models/Schema';

/**
 * WHO MAY FOLLOW WHAT on the live stream (backlog 050).
 *
 * The stream is already scoped to the caller's workspace — a notice from
 * another workspace is never handed to this connection whatever it follows —
 * but a topic that names one thing is checked too, so following `record:9`
 * for a record in someone else's workspace is refused rather than silently
 * never heard. Each check is the one the thing's own read makes:
 *
 * - a record, card, run, agent run or ask: it exists in this workspace;
 * - an artifact: it exists here and its share audience opens it for this
 *   caller (`canOpenArtifact` — an "only me" artifact follows only for its owner);
 * - `notification:<userId>`: only that person;
 * - a type's list and the workspace feeds: anyone in the workspace.
 *
 * A thing that does not exist and a thing in another workspace get the same
 * answer, so the refusal confirms nothing about ids outside the caller's own.
 */

export type TopicRefusal = { topic: string; reason: 'not_a_topic' | 'not_in_this_workspace' | 'not_yours' };

/**
 * @param caller - Who is asking (`authApi`).
 * @param rawTopics - The topics as the client wrote them.
 * @returns The topics this caller may follow, and each one refused with why.
 */
export async function authorizeTopics(caller: ApiCaller, rawTopics: readonly string[]): Promise<{ allowed: string[]; refused: TopicRefusal[] }> {
  const refused: TopicRefusal[] = [];
  const parsed: LiveTopic[] = [];
  for (const raw of new Set(rawTopics.map(t => t.trim()).filter(Boolean))) {
    const t = parseTopic(raw);
    if (t) {
      parsed.push(t);
    } else {
      refused.push({ topic: raw, reason: 'not_a_topic' });
    }
  }

  const ids = (kind: LiveTopic['kind']) => parsed.flatMap(t => (t.kind === kind && 'id' in t ? [t.id] : []));
  const orgId = caller.orgId;
  const userId = caller.principal.kind === 'user' ? caller.principal.id : null;

  const [records, cards, runs, missions, asks, artifacts] = await Promise.all([
    present(ids('record'), set => db.select({ id: businessObjectSchema.id }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, set)))),
    present(ids('card'), set => db.select({ id: actionRunSchema.id }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.id, set)))),
    present(ids('run'), set => db.select({ id: workerRunSchema.id }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.id, set)))),
    present(ids('mission'), set => db.select({ id: missionRunSchema.id }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), inArray(missionRunSchema.id, set)))),
    present(ids('ask'), set => db.select({ id: askSchema.id }).from(askSchema).where(and(eq(askSchema.orgId, orgId), inArray(askSchema.id, set)))),
    ids('artifact').length === 0
      ? Promise.resolve(new Map<number, { audience: ShareAudience; ownerId: string | null }>())
      : db
          .select({ id: artifactSchema.id, audience: artifactSchema.shareAudience, ownerId: artifactSchema.shareOwnerId })
          .from(artifactSchema)
          .where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.id, ids('artifact'))))
          .then(rows => new Map(rows.map(r => [r.id, { audience: r.audience, ownerId: r.ownerId }]))),
  ]);

  const allowed: string[] = [];
  for (const t of parsed) {
    switch (t.kind) {
      case 'feed':
      case 'list':
        allowed.push(t.topic);
        break;
      case 'notification':
        if (userId !== null && t.userId === userId) {
          allowed.push(t.topic);
        } else {
          refused.push({ topic: t.topic, reason: 'not_yours' });
        }
        break;
      case 'artifact': {
        const share = artifacts.get(t.id);
        if (!share) {
          refused.push({ topic: t.topic, reason: 'not_in_this_workspace' });
        } else if (!canOpenArtifact(share, { userId, isMember: true, hasToken: false })) {
          refused.push({ topic: t.topic, reason: 'not_yours' });
        } else {
          allowed.push(t.topic);
        }
        break;
      }
      default: {
        const found = { record: records, card: cards, run: runs, mission: missions, ask: asks }[t.kind];
        if (found.has(t.id)) {
          allowed.push(t.topic);
        } else {
          refused.push({ topic: t.topic, reason: 'not_in_this_workspace' });
        }
      }
    }
  }
  return { allowed, refused };
}

/**
 * The ids of a set that exist, by one query; none asked, none read.
 * @param wanted - The ids.
 * @param read - The query for the ones that exist here.
 */
async function present(wanted: number[], read: (set: number[]) => Promise<Array<{ id: number }>>): Promise<Set<number>> {
  if (wanted.length === 0) {
    return new Set();
  }
  return new Set((await read(wanted)).map(r => r.id));
}
