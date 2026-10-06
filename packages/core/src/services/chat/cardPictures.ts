import type { TellFile } from './tellConversation';

/**
 * THE MOCKUP GOES WITH THE ASK (Chris, 2026-10-06: "put mocks in Slack when asking for review").
 * A card that waits on a person in a thread (a Build card, a merge) is about a request; the
 * request's mockups are what the person approves against, so they go up with the ask, not one
 * click away. The request is the card's own `requestId`, or its task's.
 */

/** How many mockups go up with one ask. */
export const CARD_MOCKUPS = 3;

/**
 * The mockups of the request a card is about, as files to carry, best first. Empty when the card
 * names no request or the request has none.
 * @param orgId - The workspace.
 * @param input - The card's action input.
 */
export async function cardMockups(orgId: string, input: Record<string, unknown>): Promise<TellFile[]> {
  const [{ readRecord }, { db }, { and, eq, inArray }, { artifactSchema }] = await Promise.all([
    import('@/libs/actions/factory-dispatch'),
    import('@/libs/DB'),
    import('drizzle-orm'),
    import('@/models/Schema'),
  ]);
  let requestId = Number(input.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    const taskId = Number(input.taskId);
    const task = Number.isInteger(taskId) && taskId > 0 ? await readRecord(orgId, taskId) : null;
    requestId = Number(task?.meta.requestId);
  }
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return [];
  }
  const request = await readRecord(orgId, requestId);
  const visuals = (request?.meta.visuals ?? {}) as Record<string, unknown>;
  const ids = (Array.isArray(visuals.mockupArtifactIds) ? visuals.mockupArtifactIds : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, CARD_MOCKUPS);
  if (ids.length === 0) {
    return [];
  }
  const rows = await db.select({ id: artifactSchema.id, title: artifactSchema.title, url: artifactSchema.url, spec: artifactSchema.spec, shareAudience: artifactSchema.shareAudience })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.id, ids)));
  return ids.flatMap((id) => {
    const row = rows.find(r => r.id === id);
    const spec = (row?.spec ?? {}) as Record<string, unknown>;
    const url = row?.url || (typeof spec.url === 'string' ? spec.url : '');
    if (!row || !url || row.shareAudience === 'me') {
      return [];
    }
    return [{ url, caption: row.title.replace(/^Mockup:\s*/i, 'Mockup: '), artifactId: id }];
  });
}
