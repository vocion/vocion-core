/**
 * Cards over MCP, against a real (in-memory) database and a test-only
 * card-runnable action: which cards the caller is handed, and what a tap runs,
 * as whom, and what is refused with nothing run.
 */
import type { ConversationRun } from '@/services/ConversationService';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * A declared gate's answer for the action under test: `hold` makes it hold the proposal for a
 * person; `returnedMessage` makes it send the proposal back to its author with that message.
 */
const gateAnswer = vi.hoisted(() => ({ hold: null as string | null, returnedMessage: null as string | null }));

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/gates/actionGateRun', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/gates/actionGateRun')>();
  return {
    ...real,
    gateProposal: async (opts: Parameters<typeof real.gateProposal>[0]) => {
      if (gateAnswer.returnedMessage) {
        const record = { gate: 'critic', label: 'Test critic', verdict: 'return', findings: [] } as never;
        return { records: [record], returned: { record, message: gateAnswer.returnedMessage }, hold: null, advice: [] };
      }
      return gateAnswer.hold ? { records: [], returned: null, hold: gateAnswer.hold, advice: [] } : real.gateProposal(opts);
    },
  };
});

const { db } = await import('@/libs/DB');
const { CardCallerSchema } = await import('@/libs/actions/cardRunnable');
const { registerAction } = await import('@/libs/actions/registry');
const { actionRunSchema, agentSchema, autonomyPolicySchema, conversationMessageSchema, conversationSchema, projectSchema, tenantAccountSchema, trustRuleSchema } = await import('@/models/Schema');
const { executeAction } = await import('@/services/ActionService');
const { appendMessage, createConversation, getConversation, markCardRun } = await import('@/services/ConversationService');
const { withAdvisoryLock } = await import('@/libs/advisoryLock');
const { CARD_RETURNED_MESSAGE, CARD_RUN_FAILED_MESSAGE, cardTapPrincipal, judgeCard, runWorkspaceCard, WorkspaceCardError, workspaceCardDedupKey, workspaceCardsOf } = await import('./workspaceCards');

const ORG = 'org_cards';
const OTHER_ORG = 'org_cards_other';
const ACTION_ID = 'test.card_note';
const INTERNAL_ACTION_ID = 'test.card_internal_only';
const OWNS_KEY_ACTION_ID = 'test.card_owns_dedup_key';

/** What the test action saw when it ran: the input, and who `ctx.caller` said tapped. */
const executed: Array<{ input: unknown; caller: unknown }> = [];
/** The `ctx.origin` each run saw: where the proposal was made, never who tapped. */
const originsSeen: unknown[] = [];
let failNextRun = false;
/** What the action's `underway` hook says next; null means nothing is underway. */
let underwayNext: { line: string; href?: string | null } | null = null;

registerAction({
  id: ACTION_ID,
  name: 'Test card note',
  description: 'A test-only action an end user can run from a card.',
  inputSchema: z.object({ topic: z.string().min(1), summary: z.string().min(1) }),
  grant: 'test_card',
  external: false,
  cardRunnable: { callerSchema: CardCallerSchema },
  underway: async () => {
    const said = underwayNext;
    underwayNext = null;
    return said;
  },
  execute: async (ctx, input) => {
    if (failNextRun) {
      failNextRun = false;
      throw new Error('the downstream system said no');
    }
    executed.push({ input, caller: ctx.caller });
    originsSeen.push(ctx.origin);
    return { noteFor: ctx.caller?.email ?? null };
  },
});
// Registered but NOT card-runnable: a card for it is the agent's, filed to Review.
registerAction({
  id: INTERNAL_ACTION_ID,
  name: 'Test internal only',
  description: 'A test-only action no end user may run.',
  inputSchema: z.object({ note: z.string() }),
  grant: 'test_card',
  external: false,
  execute: async (ctx, input) => {
    executed.push({ input, caller: ctx.caller });
    return {};
  },
});

// Declares `cardRunnable` AND owns its dedup key: not allowed together, so no end user may run its cards.
registerAction({
  id: OWNS_KEY_ACTION_ID,
  name: 'Test owns dedup key',
  description: 'A test-only action that wrongly declares both cardRunnable and ownsDedupKey.',
  inputSchema: z.object({ note: z.string() }),
  grant: 'test_card',
  external: false,
  cardRunnable: { callerSchema: CardCallerSchema },
  ownsDedupKey: true,
  dedupKeyFor: input => `note:${(input as { note: string }).note}`,
  execute: async (ctx, input) => {
    executed.push({ input, caller: ctx.caller });
    return {};
  },
});

const caller = { id: 'app-user-42', name: 'Dana Reyes', email: 'dana@example.com' };
const otherEndUser = { id: 'app-user-77', name: 'Sam Ortiz', email: 'sam@example.com' };
const member = { kind: 'user' as const, id: 'token:t1', role: 'member' as const, scope: { orgId: ORG } };
const goodInput = { topic: 'refund', summary: 'The order arrived damaged and a refund was promised.' };

async function seedCard(card: Partial<Extract<ConversationRun, { type: 'card' }>> & { id: string }, orgId = ORG): Promise<number> {
  const conversation = await createConversation({ orgId, agentSlug: 'support-lead', createdBy: 'token:t1', surface: 'mcp' });
  await appendMessage({ orgId, conversationId: conversation.id, role: 'assistant', content: 'Reply.', runs: [{ type: 'card', label: 'Create a ticket', actionId: ACTION_ID, input: goodInput, endUser: true, confidence: 0.9, ...card }], agentSlug: 'support-lead' });
  return conversation.id;
}

/**
 * Hold a card's lock the way another tap does, run `whileHeld`, then let go.
 * @param conversationId - The conversation the card is in.
 * @param cardId - The card whose lock to hold.
 * @param whileHeld - What happens while the lock is taken.
 */
async function holdCardLock(conversationId: number, cardId: string, whileHeld: () => Promise<void>): Promise<void> {
  const lockName = `run_workspace_card:${ORG}:${workspaceCardDedupKey(ACTION_ID, conversationId, cardId)}`;
  const held = await withAdvisoryLock(lockName, whileHeld);

  expect(held.ran).toBe(true);
}

/** Longer than one wait the tap makes for the lock, so it has passed its first checks and retried by then. */
const TAP_HAS_REACHED_THE_LOCK_MS = 450;

/**
 * Put the action at a rung on the workspace's autonomy ladder, replacing any row it had.
 * `execute-within-bounds` carries a 0.5 confidence floor, the way an earned trust rule does.
 * @param rung - The rung to set.
 */
async function setRung(rung: 'observe' | 'recommend' | 'execute-with-approval' | 'execute-within-bounds'): Promise<void> {
  await db.delete(autonomyPolicySchema).where(eq(autonomyPolicySchema.orgId, ORG));
  await db.delete(trustRuleSchema).where(eq(trustRuleSchema.orgId, ORG));
  if (rung === 'execute-within-bounds') {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: ACTION_ID, threshold: 0.5, enabled: 'true' });
  }
  await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: ACTION_ID, rung, riskTier: 'low', minConfidence: 0.5, source: 'trust.yaml' });
}

beforeEach(async () => {
  gateAnswer.hold = null;
  gateAnswer.returnedMessage = null;
  executed.length = 0;
  originsSeen.length = 0;
  failNextRun = false;
  await db.insert(tenantAccountSchema).values({ id: 'acct_cards', name: 'Northwind', slug: 'northwind-cards' }).onConflictDoNothing();
  await db.insert(projectSchema).values([
    { id: ORG, accountId: 'acct_cards', slug: 'northwind-cards', name: 'Northwind', leadAgentSlug: 'support-lead' },
    { id: OTHER_ORG, accountId: 'acct_cards', slug: 'other-cards', name: 'Other', leadAgentSlug: 'support-lead' },
  ]).onConflictDoNothing();
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'support-lead', name: 'Support lead', systemPrompt: 'You help.' },
    { orgId: OTHER_ORG, slug: 'support-lead', name: 'Support lead', systemPrompt: 'You help.' },
  ]).onConflictDoNothing();
});

afterEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(trustRuleSchema);
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
});

describe('judgeCard', () => {
  it('shows a card whose action is card-runnable, on, and whose input passes the action\'s schema', async () => {
    expect(await judgeCard(ORG, { actionId: ACTION_ID, label: 'Create a ticket', input: goodInput })).toEqual({ kind: 'card' });
  });

  it('does not hand the caller a card for an action that owns its dedup key, even when it declares cardRunnable', async () => {
    expect(await judgeCard(ORG, { actionId: OWNS_KEY_ACTION_ID, label: 'Owns key', input: { note: 'x' } })).toEqual({ kind: 'not-runnable' });
  });

  it('does not hand the caller a card for an action no end user may run', async () => {
    expect(await judgeCard(ORG, { actionId: INTERNAL_ACTION_ID, label: 'Internal', input: { note: 'x' } })).toEqual({ kind: 'not-runnable' });
    expect(await judgeCard(ORG, { actionId: 'no.such_action', label: 'Ghost', input: {} })).toEqual({ kind: 'not-runnable' });
  });

  it('drops the card when the workspace has the action below execute-with-approval', async () => {
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: ACTION_ID, rung: 'observe', riskTier: 'low' });

    expect(await judgeCard(ORG, { actionId: ACTION_ID, label: 'Create a ticket', input: goodInput })).toMatchObject({ kind: 'refused' });
    // Another workspace's ladder is its own.
    expect(await judgeCard(OTHER_ORG, { actionId: ACTION_ID, label: 'Create a ticket', input: goodInput })).toEqual({ kind: 'card' });
  });

  it('turns a card with missing input into the Draft needed card, naming what is missing', async () => {
    const verdict = await judgeCard(ORG, { actionId: ACTION_ID, label: 'Create a ticket', input: { topic: 'refund' } });

    expect(verdict.kind).toBe('card');
    expect(verdict.kind === 'card' ? verdict.draft?.missing : '').toContain('summary');
    expect(verdict.kind === 'card' ? verdict.draft?.prompt : '').toContain('Create a ticket');
  });

  it('keeps the card pass\'s own draft marker as it is', async () => {
    const draft = { prompt: 'Draft the ticket.', missing: 'the summary' };

    expect(await judgeCard(ORG, { actionId: ACTION_ID, label: 'Create a ticket', input: {}, draft })).toEqual({ kind: 'card', draft });
  });

  it('refuses a card whose input tries to name the caller', async () => {
    expect(await judgeCard(ORG, { actionId: ACTION_ID, label: 'Create a ticket', input: { ...goodInput, caller: { id: 'x', name: 'Forged', email: 'forged@example.com' } } })).toMatchObject({ kind: 'refused' });
  });
});

describe('workspaceCardsOf', () => {
  it('returns only the end-user cards of this turn, never an unfiled one or another card on the message', () => {
    const runs: ConversationRun[] = [
      { type: 'card', id: 'card_a', label: 'Create a ticket', actionId: ACTION_ID, input: goodInput },
      { type: 'card', id: 'card_b', label: 'Unfiled', actionId: ACTION_ID, input: goodInput, state: 'unfiled' },
      { type: 'card', id: 'card_c', label: 'Review card', actionId: INTERNAL_ACTION_ID, input: {} },
    ];

    expect(workspaceCardsOf(runs, new Set(['card_a', 'card_b'])).map(c => c.id)).toEqual(['card_a']);
  });
});

describe('runWorkspaceCard', () => {
  // These cases are about what one tap does once the workspace lets an agent's proposal run at once; the rung decides that, and the next describe covers the others.
  beforeEach(() => setRung('execute-within-bounds'));

  it('runs the card\'s stored input as the action, with the caller from the call', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    const out = await runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller });

    expect(out).toMatchObject({ status: 'done', actionId: ACTION_ID, outcome: 'created', result: { noteFor: 'dana@example.com' } });
    expect(executed).toEqual([{ input: goodInput, caller }]);
    expect(out.runId).toBeGreaterThan(0);
    // One channel: the tapper is `ctx.caller`, and `ctx.origin` does not repeat them.
    expect(originsSeen).toHaveLength(1);
    expect(originsSeen[0]).not.toHaveProperty('caller');
  });

  it('records the tap on the card, so a reload shows the run and who tapped', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    const out = await runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller });
    const [message] = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, conversationId));
    const stored = message!.runsJson!.find(run => run.type === 'card');

    expect(stored).toMatchObject({ id: 'card_1', state: 'decided', runId: out.runId, decision: { action: 'run', by: 'caller:app-user-42' } });
  });

  it('reports an action that ran and failed as failed with fixed text, keeps the action\'s own error on the run row, and never hands it to the app', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    failNextRun = true;
    const out = await runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller });
    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, out.runId));

    expect(out).toMatchObject({ status: 'failed', error: CARD_RUN_FAILED_MESSAGE, result: null });
    expect(JSON.stringify(out)).not.toContain('downstream');
    expect(out.runId).toBeGreaterThan(0);
    // The workspace's people still see why it failed.
    expect(row).toMatchObject({ status: 'failed', error: 'the downstream system said no' });
  });

  it('answers a request the workspace\'s own check sent back with fixed text, never the check\'s message to the agent', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    gateAnswer.returnedMessage = 'Critic to the author: the refund amount contradicts policy 4.2, redraft before filing.';
    const refused = await runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(WorkspaceCardError);
    expect(refused).toMatchObject({ code: 'RETURNED_FOR_REVISION', message: CARD_RETURNED_MESSAGE });
    expect((refused as Error).message).not.toMatch(/Critic|policy 4\.2|redraft/);
    expect(executed).toHaveLength(0);
  });

  it('runs once when the same card is tapped twice in a row, and the second tap gets the first run back', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    const tap = { orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller };
    const first = await runWorkspaceCard(tap);
    const second = await runWorkspaceCard(tap);

    expect(executed).toHaveLength(1);
    expect(first.outcome).toBe('created');
    expect(second).toMatchObject({ outcome: 'already_decided', status: 'done', runId: first.runId });
    expect(await db.select().from(actionRunSchema)).toHaveLength(1);
  });

  it('refuses a second end user on a card after the first one\'s run is done, and the card still says who ran it', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    const first = await runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller });
    const second = runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller: otherEndUser });
    const [message] = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, conversationId));
    const stored = message!.runsJson!.find(run => run.type === 'card');

    await expect(second).rejects.toMatchObject({ code: 'CARD_NOT_AVAILABLE' });
    expect(executed).toHaveLength(1);
    expect(stored).toMatchObject({ state: 'decided', runId: first.runId, tappedBy: 'app-user-42', decision: { by: 'caller:app-user-42' } });
  });

  it('runs once when the same card is tapped twice at the same moment', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    const tap = { orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller };
    const [one, two] = await Promise.all([runWorkspaceCard(tap), runWorkspaceCard(tap)]);

    expect(executed).toHaveLength(1);
    expect([one.outcome, two.outcome].sort()).toEqual(['already_decided', 'created']);
    expect(one.runId).toBe(two.runId);
    expect(await db.select().from(actionRunSchema)).toHaveLength(1);
  });

  it('sends a tap after a failed run back to a person on the same run, and does not run the action again', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    const tap = { orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller };
    failNextRun = true;
    const failed = await runWorkspaceCard(tap);
    const again = await runWorkspaceCard(tap);

    expect(failed.status).toBe('failed');
    // The refresh puts the failed run back in Review (an agent's proposal), on the same run id.
    expect(again).toMatchObject({ status: 'pending', outcome: 'refreshed', runId: failed.runId });
    expect(executed).toHaveLength(0);
    expect(await db.select().from(actionRunSchema)).toHaveLength(1);
  });

  it('does not let one end user\'s run block another conversation\'s identical card', async () => {
    const first = await seedCard({ id: 'card_1' });
    const second = await seedCard({ id: 'card_1' });
    await runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId: first, cardId: 'card_1', caller });
    const other = await runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId: second, cardId: 'card_1', caller: { id: 'app-user-43', name: 'Sam Ortiz', email: 'sam@example.com' } });

    expect(other.outcome).toBe('created');
    expect(executed).toHaveLength(2);
  });

  it('builds the dedup key on the card prefix, from the conversation and the card', () => {
    expect(workspaceCardDedupKey(ACTION_ID, 7, 'card_1')).toBe('card:test.card_note:c7:card_1');
  });

  it.each(['filed', 'deferred', 'expired', 'unfiled'])('refuses a card in state %s with CARD_NOT_AVAILABLE, and runs nothing', async (state) => {
    const conversationId = await seedCard({ id: 'card_1', state });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'CARD_NOT_AVAILABLE' });
    expect(executed).toHaveLength(0);
  });

  it.each(['deferred', 'filed', 'expired', 'unfiled'] as const)('refuses a tap that was waiting for the card\'s lock when the card became %s, and runs nothing', async (becomes) => {
    const conversationId = await seedCard({ id: 'card_1' });
    const tap = { orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller };
    let waiting: Promise<unknown> = Promise.resolve();
    await holdCardLock(conversationId, 'card_1', async () => {
      waiting = runWorkspaceCard(tap).catch((error: unknown) => error);
      await new Promise(resolve => setTimeout(resolve, TAP_HAS_REACHED_THE_LOCK_MS));
      await markCardRun({ orgId: ORG, conversationId, cardId: 'card_1', patch: { state: becomes } });
    });

    expect(await waiting).toMatchObject({ code: 'CARD_NOT_AVAILABLE' });
    expect(executed).toHaveLength(0);
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });

  it.each(['filed', 'deferred', 'expired', 'unfiled'] as const)('refuses the card\'s own first caller on a second tap that waited for the lock when the card became %s, and runs nothing more', async (becomes) => {
    // Rung execute-with-approval: the first tap leaves a pending run and binds the card to the caller, so the second tap
    // passes the bind check (`tappedBy` is this caller) and only the availability recheck under the lock can refuse it.
    await setRung('execute-with-approval');
    const conversationId = await seedCard({ id: 'card_1' });
    const tap = { orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller };
    const first = await runWorkspaceCard(tap);
    let waiting: Promise<unknown> = Promise.resolve();
    await holdCardLock(conversationId, 'card_1', async () => {
      waiting = runWorkspaceCard(tap).catch((error: unknown) => error);
      await new Promise(resolve => setTimeout(resolve, TAP_HAS_REACHED_THE_LOCK_MS));
      await markCardRun({ orgId: ORG, conversationId, cardId: 'card_1', patch: { state: becomes } });
    });

    expect(first).toMatchObject({ status: 'pending', outcome: 'created' });
    expect(await waiting).toMatchObject({ code: 'CARD_NOT_AVAILABLE' });
    expect(executed).toHaveLength(0);
    expect(await db.select().from(actionRunSchema)).toHaveLength(1);
  });

  it('still gives a tap that waited for the lock the earlier tap\'s run when the card was decided meanwhile', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    const tap = { orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller };
    const first = await runWorkspaceCard(tap);
    let waiting: Promise<Awaited<ReturnType<typeof runWorkspaceCard>>> = Promise.resolve(first);
    await holdCardLock(conversationId, 'card_1', async () => {
      waiting = runWorkspaceCard(tap);
      await new Promise(resolve => setTimeout(resolve, TAP_HAS_REACHED_THE_LOCK_MS));
    });

    expect(await waiting).toMatchObject({ outcome: 'already_decided', runId: first.runId });
    expect(executed).toHaveLength(1);
  });

  it('says why a filed card cannot run: running it would skip Review', async () => {
    const conversationId = await seedCard({ id: 'card_1', state: 'filed', runId: 99 });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ message: expect.stringContaining('Review') });
  });

  it.each([undefined, 'proposed'])('runs a card waiting for its tap (state %s)', async (state) => {
    const conversationId = await seedCard({ id: 'card_1', ...(state ? { state } : {}) });

    expect(await runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).toMatchObject({ status: 'done' });
    expect(executed).toHaveLength(1);
  });

  it('treats a card the dashboard chat drew as not found, even when its action is card-runnable and it is waiting', async () => {
    const conversationId = await seedCard({ id: 'card_1', endUser: undefined });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'CARD_NOT_FOUND' });
    expect(executed).toHaveLength(0);
  });

  it('refuses an unknown card, and the action never runs', async () => {
    const conversationId = await seedCard({ id: 'card_1' });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_nope', caller })).rejects.toMatchObject({ code: 'CARD_NOT_FOUND' });
    expect(executed).toHaveLength(0);
  });

  it('refuses a card id that belongs to another conversation', async () => {
    await seedCard({ id: 'card_1' });
    const otherConversation = await seedCard({ id: 'card_2' });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId: otherConversation, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'CARD_NOT_FOUND' });
    expect(executed).toHaveLength(0);
  });

  it('refuses a conversation that belongs to another workspace, and the action never runs', async () => {
    const foreign = await seedCard({ id: 'card_1' }, OTHER_ORG);

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId: foreign, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
    expect(executed).toHaveLength(0);
  });

  it('names the turn\'s reason when it refuses a card the turn never put up', async () => {
    const conversationId = await seedCard({ id: 'card_1', state: 'unfiled', reason: 'turned off' });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'CARD_NOT_AVAILABLE', message: expect.stringContaining('turned off') });
  });

  it('refuses a card whose action is not registered as one an end user can run', async () => {
    const conversationId = await seedCard({ id: 'card_1', actionId: INTERNAL_ACTION_ID, input: { note: 'x' } });
    const gone = await seedCard({ id: 'card_2', actionId: 'no.such_action' });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'CARD_NOT_RUNNABLE' });
    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId: gone, cardId: 'card_2', caller })).rejects.toMatchObject({ code: 'CARD_NOT_RUNNABLE' });
    expect(executed).toHaveLength(0);
  });

  it('refuses a tap on a stored end-user card whose action has since stopped being card-runnable (here: it now owns its dedup key), so a refresh can never execute it', async () => {
    const conversationId = await seedCard({ id: 'card_1', actionId: OWNS_KEY_ACTION_ID, input: { note: 'x' } });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'CARD_NOT_RUNNABLE', message: expect.stringContaining('cannot be done from the card') });
    expect(executed).toHaveLength(0);
  });

  it('refuses when the workspace turned the action off after the card was shown', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    await setRung('recommend');

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'ACTION_DISABLED' });
    expect(executed).toHaveLength(0);
  });

  it('refuses a card still waiting on its draft', async () => {
    const conversationId = await seedCard({ id: 'card_1', input: { topic: 'refund' }, draft: { prompt: 'Draft it.', missing: 'summary: Required' } });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'CARD_NEEDS_DRAFT' });
    expect(executed).toHaveLength(0);
  });

  it('refuses stored input that carries a caller, and never lets it stand in for the real one', async () => {
    const forged = { id: 'attacker', name: 'Forged', email: 'forged@example.com' };
    const conversationId = await seedCard({ id: 'card_1', input: { ...goodInput, caller: forged } });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'CARD_INPUT_INVALID' });
    expect(executed).toHaveLength(0);
  });

  it('refuses stored input that no longer passes the action\'s schema', async () => {
    const conversationId = await seedCard({ id: 'card_1', input: { topic: '' } });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'CARD_INPUT_INVALID' });
    expect(executed).toHaveLength(0);
  });

  it('refuses a caller the action\'s schema rejects', async () => {
    const conversationId = await seedCard({ id: 'card_1' });

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller: { id: 'u1', name: 'Dana', email: 'nope' } })).rejects.toMatchObject({ code: 'CALLER_INVALID' });
    expect(executed).toHaveLength(0);
  });

  it('refuses a token that does not hold the action\'s grant, and the action never runs', async () => {
    const conversationId = await seedCard({ id: 'card_1' });
    const noGrants = { kind: 'user' as const, id: 'token:t2', scope: { orgId: ORG }, grants: [] };

    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t2', principal: noGrants, conversationId, cardId: 'card_1', caller })).rejects.toBeInstanceOf(WorkspaceCardError);
    await expect(runWorkspaceCard({ orgId: ORG, actorId: 'token:t2', principal: noGrants, conversationId, cardId: 'card_1', caller })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(executed).toHaveLength(0);
    expect(await getConversation({ orgId: ORG, id: conversationId })).not.toBeNull();
  });
});

describe('what a tap does at each rung', () => {
  const tapOf = (conversationId: number) => ({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller });

  it('leaves the run waiting for a workspace person at execute-with-approval, and does not run the action', async () => {
    await setRung('execute-with-approval');
    const conversationId = await seedCard({ id: 'card_1' });
    const out = await runWorkspaceCard(tapOf(conversationId));
    const [run] = await db.select().from(actionRunSchema);
    const [message] = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, conversationId));

    expect(out).toMatchObject({ status: 'pending', outcome: 'created', result: null });
    expect(executed).toHaveLength(0);
    expect(run).toMatchObject({ id: out.runId, status: 'pending' });
    // The card keeps waiting, now with the run it is waiting on.
    expect(message!.runsJson!.find(r => r.type === 'card')).toMatchObject({ state: 'proposed', runId: out.runId });
  });

  it('hands the app the action\'s underway line but not its link, which points into the workspace', async () => {
    await setRung('execute-within-bounds');
    const conversationId = await seedCard({ id: 'card_1' });
    underwayNext = { line: 'That request is already being handled.', href: 'https://workspace.example.com/runs/41' };
    const out = await runWorkspaceCard(tapOf(conversationId));

    expect(out).toMatchObject({ outcome: 'already_underway', underway: { line: 'That request is already being handled.' } });
    expect(out.underway).toEqual({ line: 'That request is already being handled.' });
    expect(executed).toHaveLength(0);
  });

  it('does not propose the tap as a workspace person\'s own word', async () => {
    await setRung('execute-with-approval');
    const conversationId = await seedCard({ id: 'card_1' });
    await runWorkspaceCard(tapOf(conversationId));
    const [run] = await db.select().from(actionRunSchema);

    expect(run!.proposal).toMatchObject({ agentSlug: 'support-lead', origin: { byPerson: false, caller } });
    expect(cardTapPrincipal(member, 'support-lead')).toMatchObject({ kind: 'agent', id: 'agent:support-lead', role: 'member' });
  });

  it('runs the action once, at once, at the rung that executes without approval', async () => {
    await setRung('execute-within-bounds');
    const conversationId = await seedCard({ id: 'card_1' });
    const out = await runWorkspaceCard(tapOf(conversationId));

    expect(out).toMatchObject({ status: 'done', outcome: 'created' });
    expect(executed).toEqual([{ input: goodInput, caller }]);
  });

  it('still waits for a person at that rung when the agent was less sure than the rung\'s floor, or gave no confidence', async () => {
    await setRung('execute-within-bounds');
    const unsure = await seedCard({ id: 'card_1', confidence: 0.3 });
    const silent = await seedCard({ id: 'card_1', confidence: undefined });

    expect(await runWorkspaceCard(tapOf(unsure))).toMatchObject({ status: 'pending' });
    expect(await runWorkspaceCard(tapOf(silent))).toMatchObject({ status: 'pending' });
    expect(executed).toHaveLength(0);
  });

  it('holds a tap for a person when a declared gate holds it, even at the rung that executes without approval', async () => {
    await setRung('execute-within-bounds');
    gateAnswer.hold = 'Red team found a claim the wiki does not support.';
    const conversationId = await seedCard({ id: 'card_1' });
    const out = await runWorkspaceCard(tapOf(conversationId));

    expect(out).toMatchObject({ status: 'pending', outcome: 'created' });
    expect(executed).toHaveLength(0);
  });

  it('returns the same waiting run when the card is tapped again, and still runs nothing', async () => {
    await setRung('execute-with-approval');
    const conversationId = await seedCard({ id: 'card_1' });
    const first = await runWorkspaceCard(tapOf(conversationId));
    const second = await runWorkspaceCard(tapOf(conversationId));

    expect(second).toMatchObject({ status: 'pending', outcome: 'refreshed', runId: first.runId });
    expect(await db.select().from(actionRunSchema)).toHaveLength(1);
    expect(executed).toHaveLength(0);
  });

  it('still hands the action the end user as ctx.caller when a workspace person approves the waiting run', async () => {
    await setRung('execute-with-approval');
    const conversationId = await seedCard({ id: 'card_1' });
    const waiting = await runWorkspaceCard(tapOf(conversationId));
    await executeAction(waiting.runId, ORG, { reviewedBy: 'usr-lili' });

    expect(executed).toEqual([{ input: goodInput, caller }]);
    expect(originsSeen[0]).not.toHaveProperty('caller');
  });
});

/** The stored run's proposal origin caller and status, read straight from the database. */
async function storedRun(): Promise<{ status: string; originCaller: unknown; rows: number }> {
  const rows = await db.select().from(actionRunSchema);
  return { status: rows[0]!.status, originCaller: (rows[0]!.proposal as { origin?: { caller?: unknown } }).origin?.caller, rows: rows.length };
}

describe('a card is bound to the end user who tapped it first', () => {
  const tapBy = (conversationId: number, who: typeof caller) => ({ orgId: ORG, actorId: 'token:t1', principal: member, conversationId, cardId: 'card_1', caller: who });

  it('refuses another end user on a card left pending, and the waiting run keeps the first caller', async () => {
    await setRung('execute-with-approval');
    const conversationId = await seedCard({ id: 'card_1' });
    const first = await runWorkspaceCard(tapBy(conversationId, caller));
    const refusal = await runWorkspaceCard(tapBy(conversationId, otherEndUser)).catch((error: unknown) => error as Error & { code?: string });

    expect(refusal).toMatchObject({ code: 'CARD_NOT_AVAILABLE', message: expect.stringContaining('already tapped by another caller') });
    // The error says nothing about who the first caller was.
    expect((refusal as Error).message).not.toMatch(/app-user-42|Dana/);
    expect(await storedRun()).toEqual({ status: 'pending', originCaller: caller, rows: 1 });

    // A person approving it in Review runs the first caller's request as the first caller.
    await executeAction(first.runId, ORG, { reviewedBy: 'usr-lili' });

    expect(executed).toEqual([{ input: goodInput, caller }]);
  });

  it('refuses another end user on a card whose run failed, and the failed run keeps the first caller', async () => {
    await setRung('execute-within-bounds');
    const conversationId = await seedCard({ id: 'card_1' });
    failNextRun = true;
    const failed = await runWorkspaceCard(tapBy(conversationId, caller));

    await expect(runWorkspaceCard(tapBy(conversationId, otherEndUser))).rejects.toMatchObject({ code: 'CARD_NOT_AVAILABLE' });
    expect(failed.status).toBe('failed');
    expect(await storedRun()).toMatchObject({ status: 'failed', originCaller: caller, rows: 1 });
  });

  it('lets the first end user tap again and get the same run back', async () => {
    await setRung('execute-with-approval');
    const conversationId = await seedCard({ id: 'card_1' });
    const first = await runWorkspaceCard(tapBy(conversationId, caller));
    const again = await runWorkspaceCard(tapBy(conversationId, caller));

    expect(again).toMatchObject({ outcome: 'refreshed', runId: first.runId });
    expect(await storedRun()).toMatchObject({ originCaller: caller, rows: 1 });
  });

  it('binds exactly one end user when two different ones tap at the same moment', async () => {
    await setRung('execute-with-approval');
    const conversationId = await seedCard({ id: 'card_1' });
    const settled = await Promise.allSettled([runWorkspaceCard(tapBy(conversationId, caller)), runWorkspaceCard(tapBy(conversationId, otherEndUser))]);
    const [message] = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, conversationId));
    const stored = message!.runsJson!.find(run => run.type === 'card') as { tappedBy?: string };
    const winner = stored.tappedBy === caller.id ? caller : otherEndUser;

    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await storedRun()).toMatchObject({ originCaller: winner, rows: 1 });
  });
});
