/**
 * Patching one persisted card, against PGlite.
 *
 * A login marks its card approved and a failed login writes its last attempt
 * on it, long after the turn that drew the card. The rules that matter: only
 * the named card changes, a card already decided cannot be decided twice, and
 * a card id never reaches across a conversation or an org.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { markCardRun } = await import('@/services/ConversationService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_cards';
const AT = '2026-10-01T16:12:00.000Z';

function cardRun(id: string) {
  return { type: 'card' as const, id, kind: 'link', label: `Connect ${id}`, actionId: '', state: 'proposed', href: '/api/connect/github/start' };
}

async function seedConversation(orgId: string, cardIds: string[]) {
  const [conversation] = await db.insert(conversationSchema).values({ orgId, agentSlug: 'lead', title: 'Connect tools' }).returning();
  const messageIds: number[] = [];
  for (const cardId of cardIds) {
    const [message] = await db.insert(conversationMessageSchema).values({ conversationId: conversation!.id, role: 'assistant', content: '', runsJson: [{ type: 'text', text: 'Here you go.' }, cardRun(cardId)] }).returning();
    messageIds.push(message!.id);
  }
  return { conversationId: conversation!.id, messageIds };
}

async function runsOf(messageId: number) {
  const [row] = await db.select({ runs: conversationMessageSchema.runsJson }).from(conversationMessageSchema).where(eq(conversationMessageSchema.id, messageId));
  return row!.runs;
}

function decideOnce(conversationId: number, action: string) {
  return markCardRun({ orgId: ORG, conversationId, cardId: 'card_a', expectState: 'proposed', patch: { state: 'decided', decision: { action, at: AT } } });
}

beforeEach(async () => {
  await db.delete(conversationSchema);
});

describe('markCardRun', () => {
  it('patches only the named card, and leaves the other message byte-identical', async () => {
    const { conversationId, messageIds } = await seedConversation(ORG, ['card_a', 'card_b']);
    const before = JSON.stringify(await runsOf(messageIds[0]!));

    const patched = await markCardRun({ orgId: ORG, conversationId, cardId: 'card_b', patch: { state: 'decided', decision: { action: 'approve', at: AT, by: 'user_1' } } });

    expect(patched).toBe(true);
    expect(JSON.stringify(await runsOf(messageIds[0]!))).toBe(before);

    const runs = await runsOf(messageIds[1]!);

    expect(runs?.[0]).toEqual({ type: 'text', text: 'Here you go.' });
    expect(runs?.[1]).toMatchObject({ id: 'card_b', state: 'decided', decision: { action: 'approve', at: AT, by: 'user_1' }, href: '/api/connect/github/start' });
  });

  it('refuses a card that is not in the state the caller expected, and changes nothing', async () => {
    const { conversationId, messageIds } = await seedConversation(ORG, ['card_a']);
    const decision = { action: 'approve', at: AT };
    await markCardRun({ orgId: ORG, conversationId, cardId: 'card_a', patch: { state: 'decided', decision } });
    const before = JSON.stringify(await runsOf(messageIds[0]!));

    const patched = await markCardRun({ orgId: ORG, conversationId, cardId: 'card_a', expectState: 'proposed', patch: { state: 'decided', decision: { action: 'reject', at: AT } } });

    expect(patched).toBe(false);
    expect(JSON.stringify(await runsOf(messageIds[0]!))).toBe(before);
  });

  it('lets two concurrent decisions through only once', async () => {
    const { conversationId, messageIds } = await seedConversation(ORG, ['card_a']);

    const results = await Promise.all([decideOnce(conversationId, 'approve'), decideOnce(conversationId, 'reject')]);

    expect(results.filter(Boolean)).toHaveLength(1);

    const winner = results[0] ? 'approve' : 'reject';

    expect((await runsOf(messageIds[0]!))?.[1]).toMatchObject({ decision: { action: winner } });
  });

  it('does not find a card id that lives in another conversation of the same org', async () => {
    const mine = await seedConversation(ORG, ['card_a']);
    const other = await seedConversation(ORG, ['card_other']);

    const patched = await markCardRun({ orgId: ORG, conversationId: mine.conversationId, cardId: 'card_other', patch: { state: 'decided' } });

    expect(patched).toBe(false);
    expect((await runsOf(other.messageIds[0]!))?.[1]).toMatchObject({ state: 'proposed' });
  });

  it('does not find a conversation that belongs to another org', async () => {
    const theirs = await seedConversation('org_someone_else', ['card_a']);

    const patched = await markCardRun({ orgId: ORG, conversationId: theirs.conversationId, cardId: 'card_a', patch: { state: 'decided' } });

    expect(patched).toBe(false);
    expect((await runsOf(theirs.messageIds[0]!))?.[1]).toMatchObject({ state: 'proposed' });
  });
});
