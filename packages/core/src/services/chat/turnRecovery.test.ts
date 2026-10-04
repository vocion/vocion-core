/**
 * A chat turn survives a restart (backlog 056): the turn is a row from its
 * first token, a process that finds another's running turn answers it again
 * under the same stream id with the finished steps carried over, and a turn
 * restarted on twice ends `interrupted` with its reason. The agent runtime is
 * a seam; nothing here calls a model.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { appendMessage, createConversation, listMessages, toHistoryTurns } = await import('@/services/ConversationService');
const { attachStream, hasStream } = await import('@/libs/streams/buffer');
const { beginTurn, finishTurn, processInstanceId, recordTurnProgress, runningTurnsOfOtherProcesses, turnByStreamId, writeTurn } = await import('./turnLedger');
const { INTERRUPTED_TWICE, recoverInterruptedTurns, stepsAlreadyDone } = await import('./turnRecovery');

const ORG = 'org_turn_recovery';
const USER = 'user_northwind_pm';

beforeEach(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
});

async function askedTurn(streamId: string) {
  const conv = await createConversation({ orgId: ORG, agentSlug: 'product-manager', createdBy: USER });
  const asked = await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'user', content: 'Add tags to the library', userId: USER });
  const row = await beginTurn({ orgId: ORG, conversationId: conv.id, agentSlug: 'product-manager', turn: { streamId, userMessageId: asked.id, request: { message: 'Add tags to the library', messageForModel: 'Add tags to the library', agentSlug: 'product-manager', userId: USER, allowedSourceSlugs: [], timeZone: 'UTC', attachmentIds: [] } } });
  return { conv, asked, row: row! };
}

describe('the turn ledger', () => {
  it('writes the turn as running when it begins, keeps it out of the history, and finishes it in place', async () => {
    const { conv, row } = await askedTurn('stream-a');

    const running = await listMessages({ orgId: ORG, conversationId: conv.id });

    expect(running.map(m => [m.role, m.status])).toEqual([['user', null], ['assistant', 'running']]);
    expect(toHistoryTurns(running).map(t => t.role)).toEqual(['user']);

    await recordTurnProgress(row.id, [{ type: 'tool', name: 'search_records', input: { q: 'tags' }, output: 'none yet', state: 'done' }]);
    await finishTurn({ id: row.id, conversationId: conv.id, content: 'Filed FE-9.', runs: [{ type: 'text', text: 'Filed FE-9.' }], status: 'complete', agentSlug: 'product-manager', cost: { tokens: 120, microCents: 900 } });

    const after = await listMessages({ orgId: ORG, conversationId: conv.id });

    expect(after[1]).toMatchObject({ role: 'assistant', status: 'complete', content: 'Filed FE-9.', tokens: 120 });
    expect((after[1]!.turnJson as { finishedAt?: string }).finishedAt).toBeTruthy();
    expect(after).toHaveLength(2);

    const [thread] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, conv.id));

    expect(thread).toMatchObject({ messageCount: 2, microCents: 900 });
  });

  it('finds a turn by its stream id for its own person only, and lists another process\'s running turns', async () => {
    const { row } = await askedTurn('stream-b');

    expect((await turnByStreamId(ORG, USER, 'stream-b'))?.id).toBe(row.id);
    expect(await turnByStreamId(ORG, 'someone-else', 'stream-b')).toBeNull();
    expect(await turnByStreamId('org_other', USER, 'stream-b')).toBeNull();
    expect((await runningTurnsOfOtherProcesses(processInstanceId())).map(r => r.id)).toEqual([]);
    expect((await runningTurnsOfOtherProcesses('another-host:1:0')).map(r => r.id)).toEqual([row.id]);
  });
});

describe('recovery after a restart', () => {
  it('answers another process\'s running turn again under the same stream id, carrying the finished steps, and finishes the row', async () => {
    const { conv, row } = await askedTurn('stream-c');
    await recordTurnProgress(row.id, [{ type: 'tool', name: 'search_records', input: { q: 'tags' }, output: 'no tag feature yet', state: 'done' }, { type: 'tool', name: 'file_request', input: {}, state: 'pending' }]);

    const seen: string[] = [];
    const outcome = await recoverInterruptedTurns({
      processId: 'new-host:2:1',
      run: async (turn, onEvent) => {
        expect(turn.turn.attempt).toBe(2);
        expect(turn.turn.resumedBy).toBe('new-host:2:1');
        expect(stepsAlreadyDone(turn.runs)).toContain('search_records');
        expect(stepsAlreadyDone(turn.runs)).not.toContain('file_request');
        // The stream is open under the original id before the runner speaks, so a client can attach.
        expect(hasStream('stream-c', { orgId: ORG, userId: USER })).toBe(true);

        onEvent({ type: 'response_delta', delta: 'Filed FE-12.' });
        return { status: 'complete', reason: null, text: 'Filed FE-12.', runs: [{ type: 'text', text: 'Filed FE-12.' }], documents: [], trace: [], cost: { tokens: 50, microCents: 400 } };
      },
    });

    expect(outcome).toEqual({ found: 1, resumed: 1, gaveUp: 0, failed: 0 });

    // The client's count from the first attempt is ignored on a recovered stream: everything replays.
    attachStream('stream-c', { orgId: ORG, userId: USER }, 7, d => seen.push(JSON.parse(d).type), () => seen.push('__done__'));

    expect(seen).toEqual(['turn_restarted', 'turn_agent', 'response_delta', '__done__']);

    const after = await listMessages({ orgId: ORG, conversationId: conv.id });

    expect(after[1]).toMatchObject({ status: 'complete', content: 'Filed FE-12.', tokens: 50 });
    expect((after[1]!.turnJson as { attempt: number }).attempt).toBe(2);
  });

  it('ends a turn restarted on twice as interrupted, with the reason, and runs nothing', async () => {
    const { conv, row } = await askedTurn('stream-d');
    const turn = (await turnByStreamId(ORG, USER, 'stream-d'))!.turn;
    await writeTurn(row.id, { ...turn, attempt: 2, processId: 'old-host:9:0' });

    const outcome = await recoverInterruptedTurns({ processId: 'new-host:3:1', run: async () => {
      throw new Error('must not run');
    } });

    expect(outcome).toEqual({ found: 1, resumed: 0, gaveUp: 1, failed: 0 });

    const after = await listMessages({ orgId: ORG, conversationId: conv.id });

    expect(after[1]).toMatchObject({ status: 'interrupted', statusReason: INTERRUPTED_TWICE });
    expect(toHistoryTurns(after).map(t => t.role)).toEqual(['user']);
  });

  it('a re-run that throws ends the turn incomplete with the reason, and the stream still closes', async () => {
    const { conv } = await askedTurn('stream-e');
    const seen: string[] = [];

    const outcome = await recoverInterruptedTurns({ processId: 'new-host:4:1', run: async () => {
      throw new Error('model unreachable');
    } });

    expect(outcome).toEqual({ found: 1, resumed: 0, gaveUp: 0, failed: 1 });

    attachStream('stream-e', { orgId: ORG, userId: USER }, 0, d => seen.push(JSON.parse(d).type), () => seen.push('__done__'));

    expect(seen).toEqual(['turn_restarted', 'turn_agent', 'error', 'done', '__done__']);

    const after = await listMessages({ orgId: ORG, conversationId: conv.id });

    expect(after[1]).toMatchObject({ status: 'incomplete', statusReason: expect.stringContaining('model unreachable') });
  });
});
