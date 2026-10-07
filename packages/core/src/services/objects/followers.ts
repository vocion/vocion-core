/**
 * THE CONVERSATION THAT ACTS FOLLOWS (FE-133, 2026-10-06). A request is filed in one conversation
 * and acted on in another: FE-133 was asked for in the app's chat on Sep 25, and pressed Build
 * in a Slack thread eleven days later. Every later move was told to the conversation it came
 * from, which nobody was in, and the thread that pressed Build heard nothing, not even that a
 * new plan waited on the person who pressed it. A conversation that proposes an action on a
 * record now follows that record, and what the record tells its asker goes to its followers too.
 */

/** How many conversations a record keeps as followers, newest kept. */
export const MAX_FOLLOWERS = 5;

/**
 * The conversations following a record, from its metadata.
 * @param meta - The record's metadata.
 */
export function followersOf(meta: Record<string, unknown> | null | undefined): number[] {
  const raw = (meta ?? {}).followConversations;
  return (Array.isArray(raw) ? raw : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
}

/**
 * The record an action is about: its `requestId`, else the request of its `planId` or `taskId`.
 * @param orgId - The workspace.
 * @param input - The action's input.
 */
export async function actionRecord(orgId: string, input: Record<string, unknown>): Promise<number | null> {
  const direct = Number(input.requestId);
  if (Number.isInteger(direct) && direct > 0) {
    return direct;
  }
  const via = Number(input.planId ?? input.taskId);
  if (!Number.isInteger(via) || via <= 0) {
    return null;
  }
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  const parent = Number((await readRecord(orgId, via))?.meta.requestId);
  return Number.isInteger(parent) && parent > 0 ? parent : null;
}

/**
 * Make a conversation a follower of the record an action is about. Never throws.
 * @param orgId - The workspace.
 * @param input - The action's input.
 * @param conversationId - The conversation that proposed it.
 */
export async function followFromAction(orgId: string, input: Record<string, unknown>, conversationId: number): Promise<void> {
  try {
    const recordId = await actionRecord(orgId, input);
    if (!recordId) {
      return;
    }
    const { readRecord, writeMeta } = await import('@/libs/actions/factory-dispatch');
    const record = await readRecord(orgId, recordId);
    if (!record) {
      return;
    }
    const now = followersOf(record.meta);
    if (now.includes(conversationId)) {
      return;
    }
    await writeMeta(orgId, recordId, { followConversations: [...now, conversationId].slice(-MAX_FOLLOWERS) });
  } catch {
    // Following is a courtesy: the action stands either way.
  }
}
