/**
 * Answering a choice card, against PGlite (#1028).
 *
 * The rules someone could get wrong: the card and its bound actions come from
 * the persisted row and never from the request, two answers racing on one card
 * run its action once, a failing action never un-answers the card, and a card
 * id from another conversation or org is not found (never "already answered").
 */
import type { Action } from '@/libs/actions/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { answerChoice } = await import('@/services/chat/answerChoice');
const { eq } = await import('drizzle-orm');

const ORG = 'org_interview';
const USER = 'user_dana';

const probeInput = z.object({ n: z.number(), boom: z.boolean().optional() });
const ran: Array<Record<string, unknown>> = [];

const probeAction: Action<typeof probeInput> = {
  id: 'test.interview_probe',
  name: 'Interview probe',
  description: 'Counts how many times a picked option ran it; throws when told to.',
  inputSchema: probeInput,
  grant: 'interview_probe',
  external: false,
  dedupKeyFor: input => `test.interview_probe:${input.n}`,
  async execute(_ctx, input) {
    ran.push(input);
    if (input.boom) {
      throw new Error('the probe exploded');
    }
    return { probed: input.n };
  },
};
registerAction(probeAction);

type Options = Array<{ id: 'A' | 'B' | 'C' | 'D'; label: string; actions?: Array<{ actionId: string; input: Record<string, unknown> }> }>;

const THREE_OPTIONS: Options = [
  { id: 'A', label: 'Ship faster' },
  { id: 'B', label: 'Fewer bugs' },
  { id: 'C', label: 'Both' },
];

function choiceCard(id: string, options: Options, extra: Record<string, unknown> = {}) {
  return { type: 'card' as const, id, kind: 'choice', label: 'What matters most?', actionId: '', state: 'proposed', options, ...extra };
}

async function seedConversation(orgId: string, cards: Array<ReturnType<typeof choiceCard>>) {
  const [conversation] = await db.insert(conversationSchema).values({ orgId, agentSlug: 'lead', title: 'Setup' }).returning();
  const [message] = await db.insert(conversationMessageSchema).values({ conversationId: conversation!.id, role: 'assistant', content: '', runsJson: cards }).returning();
  return { conversationId: conversation!.id, messageId: message!.id };
}

async function cardOf(messageId: number, cardId: string) {
  const [row] = await db.select({ runs: conversationMessageSchema.runsJson }).from(conversationMessageSchema).where(eq(conversationMessageSchema.id, messageId));
  return row!.runs!.find(run => run.type === 'card' && run.id === cardId) as Record<string, unknown>;
}

beforeEach(async () => {
  ran.length = 0;
  await db.delete(actionRunSchema);
  await db.delete(conversationSchema);
});

describe('answerChoice', () => {
  it('an unbound option answers the card: the person\'s words are the option label and the card reads decided', async () => {
    const { conversationId, messageId } = await seedConversation(ORG, [choiceCard('card_q', THREE_OPTIONS)]);

    const out = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_q', optionId: 'A' } });

    expect(out).toMatchObject({
      ok: true,
      question: 'What matters most?',
      answerText: 'Ship faster',
      actionOutcome: null,
      modelPrefix: 'Answered "What matters most?": Ship faster',
      userRuns: [{ type: 'card_decision', cardId: 'card_q', action: 'answer', label: 'What matters most?', option: 'A' }],
    });
    expect(await cardOf(messageId, 'card_q')).toMatchObject({ state: 'decided', answer: { optionId: 'A', text: 'Ship faster', by: USER } });
  });

  it('"other" carries the typed words; empty text is refused, and so is "other" on a card that does not allow it', async () => {
    const { conversationId, messageId } = await seedConversation(ORG, [choiceCard('card_open', THREE_OPTIONS), choiceCard('card_closed', THREE_OPTIONS, { allowOther: false })]);

    const empty = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_open', optionId: 'other', text: '   ' } });
    const closed = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_closed', optionId: 'other', text: 'Neither' } });

    expect(empty).toMatchObject({ ok: false, status: 400 });
    expect(closed).toMatchObject({ ok: false, status: 400 });
    expect(await cardOf(messageId, 'card_open')).toMatchObject({ state: 'proposed' });

    const typed = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_open', optionId: 'other', text: ' Keep the team happy ' } });

    expect(typed).toMatchObject({ ok: true, answerText: 'Keep the team happy', modelPrefix: 'Answered "What matters most?": Keep the team happy' });
    expect(await cardOf(messageId, 'card_open')).toMatchObject({ answer: { optionId: 'other', text: 'Keep the team happy' } });
  });

  it('a card id from another conversation or another org is 404, never 409, and nothing changes', async () => {
    const mine = await seedConversation(ORG, [choiceCard('card_mine', THREE_OPTIONS)]);
    const theirs = await seedConversation('org_elsewhere', [choiceCard('card_theirs', THREE_OPTIONS)]);
    const sibling = await seedConversation(ORG, [choiceCard('card_sibling', THREE_OPTIONS)]);

    const otherOrg = await answerChoice({ orgId: ORG, userId: USER, conversationId: mine.conversationId, answer: { cardId: 'card_theirs', optionId: 'A' } });
    const otherConversation = await answerChoice({ orgId: ORG, userId: USER, conversationId: mine.conversationId, answer: { cardId: 'card_sibling', optionId: 'A' } });
    const crossOrgConversation = await answerChoice({ orgId: ORG, userId: USER, conversationId: theirs.conversationId, answer: { cardId: 'card_theirs', optionId: 'A' } });

    expect(otherOrg).toMatchObject({ ok: false, status: 404 });
    expect(otherConversation).toMatchObject({ ok: false, status: 404 });
    expect(crossOrgConversation).toMatchObject({ ok: false, status: 404 });
    expect(await cardOf(sibling.messageId, 'card_sibling')).toMatchObject({ state: 'proposed' });
    expect(await cardOf(theirs.messageId, 'card_theirs')).toMatchObject({ state: 'proposed' });
  });

  it('an option the card does not have is 400 and leaves the card open', async () => {
    const { conversationId, messageId } = await seedConversation(ORG, [choiceCard('card_q', THREE_OPTIONS)]);

    const out = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_q', optionId: 'D' } });

    expect(out).toMatchObject({ ok: false, status: 400 });
    expect(await cardOf(messageId, 'card_q')).toMatchObject({ state: 'proposed' });
  });

  it('an answered or skipped card is 409', async () => {
    const { conversationId } = await seedConversation(ORG, [choiceCard('card_done', THREE_OPTIONS, { state: 'decided' }), choiceCard('card_skipped', THREE_OPTIONS, { state: 'deferred' })]);

    const answered = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_done', optionId: 'A' } });
    const skipped = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_skipped', optionId: 'A' } });

    expect(answered).toMatchObject({ ok: false, status: 409 });
    expect(skipped).toMatchObject({ ok: false, status: 409 });
  });

  it('two answers at once: exactly one wins, the other is 409, and the bound action ran once', async () => {
    const options: Options = [{ id: 'A', label: 'Do it', actions: [{ actionId: 'test.interview_probe', input: { n: 1 } }] }, { id: 'B', label: 'Not now' }];
    const { conversationId, messageId } = await seedConversation(ORG, [choiceCard('card_race', options)]);

    const results = await Promise.all([
      answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_race', optionId: 'A' } }),
      answerChoice({ orgId: ORG, userId: 'user_second_tab', conversationId, answer: { cardId: 'card_race', optionId: 'A' } }),
    ]);

    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.filter(r => !r.ok)).toEqual([expect.objectContaining({ status: 409 })]);
    expect(ran).toHaveLength(1);
    expect(await db.select().from(actionRunSchema).where(eq(actionRunSchema.actionId, 'test.interview_probe'))).toHaveLength(1);
    expect(await cardOf(messageId, 'card_race')).toMatchObject({ state: 'decided' });
  });

  it('runs the action the card carries as the person who answered, and tells the agent what it did', async () => {
    const options: Options = [{ id: 'A', label: 'Do it', actions: [{ actionId: 'test.interview_probe', input: { n: 7 } }] }];
    const { conversationId } = await seedConversation(ORG, [choiceCard('card_bound', options)]);

    const out = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_bound', optionId: 'A' } });

    expect(ran).toEqual([{ n: 7 }]);

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.actionId, 'test.interview_probe'));

    expect(run).toMatchObject({ orgId: ORG, invokedBy: USER, status: 'done', input: { n: 7 } });
    expect(out.ok && out.modelPrefix).toMatch(/^Answered "What matters most\?": Do it\n\(test\.interview_probe ran: /);
  });

  it('an action that throws does not un-answer the card; the agent is told it failed and why', async () => {
    const options: Options = [{ id: 'A', label: 'Do it', actions: [{ actionId: 'test.interview_probe', input: { n: 2, boom: true } }] }];
    const { conversationId, messageId } = await seedConversation(ORG, [choiceCard('card_boom', options)]);

    const out = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_boom', optionId: 'A' } });

    expect(out.ok).toBe(true);
    expect(out.ok && out.modelPrefix).toContain('(test.interview_probe failed: the probe exploded)');
    expect(await cardOf(messageId, 'card_boom')).toMatchObject({ state: 'decided', answer: { optionId: 'A' } });
  });

  it('two bound actions where the first throws: the second still runs, one failed line then one ran line, in order', async () => {
    const options: Options = [{
      id: 'A',
      label: 'Do both',
      actions: [
        { actionId: 'test.interview_probe', input: { n: 3, boom: true } },
        { actionId: 'test.interview_probe', input: { n: 4 } },
      ],
    }];
    const { conversationId } = await seedConversation(ORG, [choiceCard('card_two', options)]);

    const out = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_two', optionId: 'A' } });

    expect(ran.map(r => r.n)).toEqual([3, 4]);

    const lines = out.ok ? out.modelPrefix.split('\n') : [];

    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('(test.interview_probe failed: the probe exploded)');
    expect(lines[2]).toMatch(/^\(test\.interview_probe ran: /);
    expect(out.ok && out.actionOutcome?.split('\n')).toHaveLength(2);
  });

  it('an action id nobody registered is a failed line, not a thrown error', async () => {
    const options: Options = [{ id: 'A', label: 'Do it', actions: [{ actionId: 'test.not_registered', input: {} }] }];
    const { conversationId } = await seedConversation(ORG, [choiceCard('card_ghost', options)]);

    const out = await answerChoice({ orgId: ORG, userId: USER, conversationId, answer: { cardId: 'card_ghost', optionId: 'A' } });

    expect(out.ok && out.modelPrefix).toContain('(test.not_registered failed: No registered action: test.not_registered)');
  });
});
