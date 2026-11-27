/**
 * `ask_workspace` and `list_agents` over MCP, end to end through the in-memory
 * transport with the model stubbed at the turn seam: the router picks the
 * agent and says why, the turn is persisted as a conversation, a continued
 * conversation skips the router, a named slug skips it too, an unknown slug
 * is refused with the roster, an inactive agent is refused, and a slow turn
 * comes back truncated with the rest landing in the conversation.
 */
import type { McpConfig } from '../config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));

const runAgentDeep = vi.fn();
vi.mock('@/services/AgentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/AgentService')>();
  return { ...actual, runAgentDeep: (...args: unknown[]) => runAgentDeep(...args) };
});
// The router's model read, scripted per test; unscripted it fails, and the
// keyword fallback decides — no test here calls a model.
const readRoute = vi.fn();
vi.mock('@/services/agents/routeRead', () => ({ readRoute: (...args: unknown[]) => readRoute(...args) }));
// The card check, real unless a test makes it throw.
const failingCardCheck = vi.fn();
// The card run, real unless a test makes it throw something unexpected.
const failingCardRun = vi.fn();
vi.mock('@/services/chat/workspaceCards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/chat/workspaceCards')>();
  return {
    ...actual,
    judgeCard: (...args: Parameters<typeof actual.judgeCard>) => failingCardCheck() ?? actual.judgeCard(...args),
    runWorkspaceCard: (...args: Parameters<typeof actual.runWorkspaceCard>) => failingCardRun() ?? actual.runWorkspaceCard(...args),
  };
});
// The Talk to a person writer's model, scripted per test; unscripted, the real one is built.
const requestWriterModel = vi.fn();
vi.mock('@/libs/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/llm')>();
  return { ...actual, buildChatModelForOrg: (...args: Parameters<typeof actual.buildChatModelForOrg>) => requestWriterModel() ?? actual.buildChatModelForOrg(...args) };
});
// The Talk to a person tap, real unless a test makes it throw something unexpected.
const failingTalk = vi.fn();
vi.mock('@/services/chat/talkToAPerson', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/chat/talkToAPerson')>();
  return { ...actual, talkToAPerson: (...args: Parameters<typeof actual.talkToAPerson>) => failingTalk() ?? actual.talkToAPerson(...args) };
});
vi.mock('@/services/BudgetService', () => ({
  preflightCheck: vi.fn(async () => ({ ok: true })),
  chargeUsage: vi.fn(async () => {}),
}));

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { CardCallerSchema } = await import('@/libs/actions/cardRunnable');
const { registerAction } = await import('@/libs/actions/registry');
const { actionRunSchema, agentSchema, autonomyPolicySchema, conversationMessageSchema, conversationSchema, projectSchema, tenantAccountSchema, trustRuleSchema } = await import('@/models/Schema');
const { askWorkspace } = await import('@/services/chat/workspaceTurn');
const { appendMessage, createConversation } = await import('@/services/ConversationService');
const { REQUEST_NOT_WRITTEN_MESSAGE } = await import('@/services/chat/talkToAPerson');
const { buildServer } = await import('../server');
const { CARD_INTERNAL_ERROR_MESSAGE, PAUSED_TALK_MESSAGE, TALK_INTERNAL_ERROR_MESSAGE } = await import('./chat-tools');
const { logger } = await import('@/libs/Logger');

const ORG = 'org_mcp_chat';
const scratchDir = mkdtempSync(join(tmpdir(), 'cc-mcp-chat-'));

const config: McpConfig = {
  orgId: ORG,
  contextPath: scratchDir,
  diskWorkspace: true,
  autoCommit: false,
  autoApply: false,
  serverName: 'vocion-test',
  serverVersion: '0.0.0',
};

/** What the test-only card action saw each time it ran. */
const cardActionRuns: Array<{ input: unknown; caller: unknown }> = [];
const CARD_ACTION_ID = 'test.card_ticket';
const OWNS_KEY_ACTION_ID = 'test.card_owns_key';

registerAction({
  id: CARD_ACTION_ID,
  name: 'Test card ticket',
  description: 'A test-only action an end user can run from a card.',
  inputSchema: z.object({ topic: z.string().min(1), summary: z.string().min(1) }),
  grant: 'test_card',
  external: false,
  cardRunnable: { callerSchema: CardCallerSchema },
  execute: async (ctx, input) => {
    cardActionRuns.push({ input, caller: ctx.caller });
    return { ticketFor: ctx.caller?.email ?? null };
  },
});

// Declares `cardRunnable` AND owns its dedup key: not allowed together, so the turn treats it as not card-runnable.
registerAction({
  id: OWNS_KEY_ACTION_ID,
  name: 'Test owns dedup key',
  description: 'A test-only action that wrongly declares both cardRunnable and ownsDedupKey.',
  inputSchema: z.object({ topic: z.string().min(1), summary: z.string().min(1) }),
  grant: 'test_card',
  external: false,
  cardRunnable: { callerSchema: CardCallerSchema },
  ownsDedupKey: true,
  dedupKeyFor: input => `ticket:${(input as { topic: string }).topic}`,
  execute: async (ctx, input) => {
    cardActionRuns.push({ input, caller: ctx.caller });
    return {};
  },
});

type ToolResult = { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

async function setup() {
  const server = await buildServer(config, { userId: 'token:t1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function text(result: ToolResult): string {
  return result.content?.find(c => c.type === 'text')?.text ?? '';
}

function parse<T>(result: ToolResult): T {
  if (result.isError) {
    throw new Error(text(result));
  }
  return JSON.parse(text(result)) as T;
}

type Reply = {
  reply: string;
  truncated: boolean;
  agentSlug: string;
  agentName: string;
  routing: { chosen: string; defaulted: boolean; reason: string; candidates: Array<{ slug: string; score: number }> } | null;
  conversationId: number;
  turnId: number;
  actions: unknown[];
  url: string;
};

/**
 * A turn that streams two deltas and answers.
 * @param reply
 */
function scriptedTurn(reply: string) {
  runAgentDeep.mockImplementation(async (opts: { onEvent?: (e: unknown) => void; agentSlug: string }) => {
    const half = Math.ceil(reply.length / 2);
    opts.onEvent?.({ type: 'response_delta', delta: reply.slice(0, half) });
    opts.onEvent?.({ type: 'response_delta', delta: reply.slice(half) });
    opts.onEvent?.({ type: 'done', response: reply, traceId: `trace-${opts.agentSlug}` });
    return { response: reply, traceId: `trace-${opts.agentSlug}`, toolCalls: [] };
  });
}

beforeEach(async () => {
  failingCardCheck.mockReset();
  failingCardRun.mockReset();
  requestWriterModel.mockReset();
  failingTalk.mockReset();
  runAgentDeep.mockReset();
  readRoute.mockReset();
  readRoute.mockRejectedValue(new Error('no model in this test'));
  await db.delete(actionRunSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(trustRuleSchema);
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  cardActionRuns.length = 0;
  await db.insert(tenantAccountSchema).values({ id: 'acct_chat', name: 'Northwind', slug: 'northwind' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_chat', slug: 'northwind', name: 'Northwind', leadAgentSlug: 'revenue-lead' });
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'revenue-lead', name: 'Revenue lead', systemPrompt: 'You lead.', description: 'Runs the revenue workspace: pipeline, deals, forecasts.', handles: ['pipeline', 'deals'], eyebrow: 'Revenue' },
    { orgId: ORG, slug: 'wiki-researcher', name: 'Wiki researcher', systemPrompt: 'You research.', description: 'Answers first and writes it down.', handles: ['wiki', 'standing rules', 'research'], initiative: 'high', suggestions: [{ label: 'Research this', prompt: 'Research the following.' }] },
    { orgId: ORG, slug: 'retired-agent', name: 'Retired', systemPrompt: 'x', active: 'false', handles: ['wiki'] },
  ]);
});

afterAll(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  rmSync(scratchDir, { recursive: true, force: true });
});

describe('list_agents', () => {
  it('lists the roster with what each handles, its initiative and the lead', async () => {
    const { client, server } = await setup();
    try {
      const names = (await client.listTools()).tools.map(t => t.name);

      expect(names).toEqual(expect.arrayContaining(['list_agents', 'ask_workspace']));

      const { agents } = parse<{ agents: Array<Record<string, unknown>> }>(await client.callTool({ name: 'list_agents', arguments: {} }) as ToolResult);

      expect(agents.find(a => a.slug === 'revenue-lead')).toMatchObject({ lead: true, initiative: 'normal', handles: ['pipeline', 'deals'], eyebrow: 'Revenue' });
      expect(agents.find(a => a.slug === 'wiki-researcher')).toMatchObject({ lead: false, initiative: 'high', active: true, suggestions: [{ label: 'Research this', prompt: 'Research the following.' }] });
      expect(agents.find(a => a.slug === 'retired-agent')).toMatchObject({ active: false });
    } finally {
      await server.close();
    }
  });
});

describe('ask_workspace', () => {
  it('routes a wiki question to the researcher, says why, and persists the turn with the decision', async () => {
    scriptedTurn('The house voice is on /wiki/voice.md.');
    const { client, server } = await setup();
    try {
      readRoute.mockResolvedValueOnce({ chosen: 'wiki-researcher', confidence: 0.9, reason: 'A question about what the wiki says; the researcher answers from the wiki.' });
      const out = parse<Reply>(await client.callTool({ name: 'ask_workspace', arguments: { message: 'What does the wiki say about our house voice?' } }) as ToolResult);

      expect(out).toMatchObject({ reply: 'The house voice is on /wiki/voice.md.', truncated: false, agentSlug: 'wiki-researcher', agentName: 'Wiki researcher' });
      expect(out.routing).toMatchObject({ chosen: 'wiki-researcher', defaulted: false, decidedBy: 'model', confidence: 0.9 });
      expect(out.routing!.reason).toMatch(/researcher answers from the wiki/);
      // The inactive agent handled "wiki" too and was never on the roster the model read.
      expect((readRoute.mock.calls[0]![0] as { agents: Array<{ slug: string }> }).agents.map(a => a.slug)).toEqual(['revenue-lead', 'wiki-researcher']);
      // Named with its account, for a reader in two accounts (vocion-core#128).
      expect(out.url).toBe(`/w/northwind/dashboard/chat/${out.conversationId}?org=northwind`);

      // The turn ran as the researcher, as the token, with the surface note under the message.
      expect(runAgentDeep).toHaveBeenCalledTimes(1);

      const call = runAgentDeep.mock.calls[0]![0] as { agentSlug: string; userId: string; message: string; conversationId: number; conversationHistory: unknown[] };

      expect(call).toMatchObject({ agentSlug: 'wiki-researcher', userId: 'token:t1', conversationId: out.conversationId, conversationHistory: [] });
      expect(call.message).toContain('What does the wiki say about our house voice?');
      expect(call.message).toContain('arrived over MCP');

      // Persisted: the conversation on the mcp surface, the person's message
      // carrying the routing decision, the assistant turn as the reply.
      const [conv] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, out.conversationId));

      expect(conv).toMatchObject({ orgId: ORG, agentSlug: 'wiki-researcher', surface: 'mcp', createdBy: 'token:t1', messageCount: 2 });

      const msgs = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, out.conversationId));

      expect(msgs.map(m => [m.role, m.content])).toEqual([['user', 'What does the wiki say about our house voice?'], ['assistant', 'The house voice is on /wiki/voice.md.']]);
      expect(msgs[0]!.routingJson).toMatchObject({ chosen: 'wiki-researcher', surface: 'mcp' });
      expect(msgs[1]!.id).toBe(out.turnId);
    } finally {
      await server.close();
    }
  });

  it('defaults to the workspace lead when the model is unsure, and says so', async () => {
    scriptedTurn('Good morning.');
    readRoute.mockResolvedValueOnce({ chosen: 'wiki-researcher', confidence: 0.2, reason: 'A greeting; nothing to research.' });
    const { client, server } = await setup();
    try {
      const out = parse<Reply>(await client.callTool({ name: 'ask_workspace', arguments: { message: 'Good morning, how are things?' } }) as ToolResult);

      expect(out.agentSlug).toBe('revenue-lead');
      expect(out.routing).toMatchObject({ chosen: 'revenue-lead', defaulted: true });
      expect(out.routing!.reason).toMatch(/the lead answers/);
    } finally {
      await server.close();
    }
  });

  it('continues a conversation with its own agent, no routing, with the history replayed', async () => {
    scriptedTurn('First answer.');
    const { client, server } = await setup();
    try {
      const first = parse<Reply>(await client.callTool({ name: 'ask_workspace', arguments: { message: 'Research our onboarding pricing', title: 'Pricing' } }) as ToolResult);

      expect(first.agentSlug).toBe('wiki-researcher');

      scriptedTurn('Second answer.');
      // A follow-up that would route to the lead on its own words stays with the researcher.
      const second = parse<Reply>(await client.callTool({ name: 'ask_workspace', arguments: { message: 'And the pipeline deals?', conversation_id: first.conversationId } }) as ToolResult);

      expect(second).toMatchObject({ agentSlug: 'wiki-researcher', routing: null, conversationId: first.conversationId, reply: 'Second answer.' });

      const call = runAgentDeep.mock.calls[1]![0] as { conversationHistory: Array<{ role: string; content: string }> };

      expect(call.conversationHistory.map(t => t.role)).toEqual(['user', 'assistant']);
      expect(call.conversationHistory[1]!.content).toBe('First answer.');

      const [conv] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, first.conversationId));

      expect(conv).toMatchObject({ title: 'Pricing', messageCount: 4 });
    } finally {
      await server.close();
    }
  });

  it('skips the router for a named slug, and refuses an unknown or inactive one with the roster', async () => {
    scriptedTurn('As you asked.');
    const { client, server } = await setup();
    try {
      const named = parse<Reply>(await client.callTool({ name: 'ask_workspace', arguments: { message: 'What does the wiki say?', agent_slug: 'revenue-lead' } }) as ToolResult);

      expect(named).toMatchObject({ agentSlug: 'revenue-lead', routing: null });

      const unknown = (await client.callTool({ name: 'ask_workspace', arguments: { message: 'hi', agent_slug: 'nobody' } })) as ToolResult;

      expect(unknown.isError).toBe(true);
      expect(text(unknown)).toMatch(/^AGENT_NOT_FOUND: No agent "nobody"/);
      expect(text(unknown)).toContain('Available: revenue-lead, wiki-researcher');

      const inactive = (await client.callTool({ name: 'ask_workspace', arguments: { message: 'hi', agent_slug: 'retired-agent' } })) as ToolResult;

      expect(inactive.isError).toBe(true);
      expect(text(inactive)).toMatch(/^AGENT_INACTIVE/);
      // Neither refusal ran a turn or opened a conversation.
      expect(runAgentDeep).toHaveBeenCalledTimes(1);
      expect(await db.select().from(conversationSchema)).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('refuses a conversation another org holds, and an empty message', async () => {
    await db.insert(conversationSchema).values({ orgId: 'org_other', agentSlug: 'x', title: 'theirs' });
    const [theirs] = await db.select().from(conversationSchema).where(eq(conversationSchema.orgId, 'org_other'));
    const { client, server } = await setup();
    try {
      const foreign = (await client.callTool({ name: 'ask_workspace', arguments: { message: 'hi', conversation_id: theirs!.id } })) as ToolResult;

      expect(foreign.isError).toBe(true);
      expect(text(foreign)).toMatch(/^CONVERSATION_NOT_FOUND/);

      const blank = (await client.callTool({ name: 'ask_workspace', arguments: { message: '   ' } })) as ToolResult;

      expect(blank.isError).toBe(true);
      expect(text(blank)).toMatch(/VALIDATION_FAILED: message is required/);
    } finally {
      await server.close();
    }
  });

  it('returns what was said so far when the turn outruns the limit, and the rest lands in the conversation', async () => {
    vi.stubEnv('VOCION_CHAT_TURN_LIMIT_MS', '50');
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    runAgentDeep.mockImplementation(async (opts: { onEvent?: (e: unknown) => void }) => {
      opts.onEvent?.({ type: 'response_delta', delta: 'Half an answer' });
      await finished;
      opts.onEvent?.({ type: 'response_delta', delta: ', and the other half.' });
      opts.onEvent?.({ type: 'done', response: 'Half an answer, and the other half.', traceId: 't' });
      return { response: 'Half an answer, and the other half.', traceId: 't', toolCalls: [] };
    });
    const { client, server } = await setup();
    try {
      const out = parse<Reply>(await client.callTool({ name: 'ask_workspace', arguments: { message: 'Research the wiki for our voice' } }) as ToolResult);

      expect(out).toMatchObject({ truncated: true, reply: 'Half an answer', agentSlug: 'wiki-researcher' });

      const before = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, out.conversationId));

      expect(before).toHaveLength(2);
      expect(before[1]!.content).toContain('Half an answer');
      expect(before[1]!.content).toContain('cut off');
      // `truncated`, not failed: the turn is still running, and both halves
      // are replayed to the model because together they are one answer (#114).
      expect(before[1]!.status).toBe('truncated');

      finish();
      await vi.waitFor(async () => {
        const after = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, out.conversationId));

        expect(after).toHaveLength(3);
        expect(after[2]!.content).toBe(', and the other half.');
        expect(after[2]!.status).toBe('continued');
      });
    } finally {
      vi.unstubAllEnvs();
      await server.close();
    }
  });
});

type Card = { id: string; label: string; actionId: string; input: Record<string, unknown>; draft?: { prompt: string; missing: string } };
type CardReply = Reply & { cards: Card[] };

/**
 * A turn whose agent puts up one card for the test action.
 * @param input - What the card would run with.
 * @param actionId - Which action the card is for.
 */
function scriptedCardTurn(input: Record<string, unknown>, actionId = CARD_ACTION_ID) {
  runAgentDeep.mockImplementation(async (opts: { onEvent?: (e: unknown) => void }) => {
    opts.onEvent?.({ type: 'recommended_action', recommendation: { label: 'Open a ticket', actionId, input, rationale: 'The customer asked.', confidence: 0.9 } });
    opts.onEvent?.({ type: 'done', response: 'Here you go.', traceId: 't' });
    return { response: 'Here you go.', traceId: 't', toolCalls: [] };
  });
}

const tapper = { id: 'app-user-42', name: 'Dana Reyes', email: 'dana@example.com' };
const completeInput = { topic: 'refund', summary: 'The order arrived damaged.' };

/**
 * Ask for the card the way a calling app with end users does: with `end_user_cards`.
 * @param client - The MCP client.
 */
async function askForCard(client: Client): Promise<CardReply> {
  return parse<CardReply>(await client.callTool({ name: 'ask_workspace', arguments: { message: 'Open a ticket for the refund', agent_slug: 'revenue-lead', end_user_cards: true } }) as ToolResult);
}

/**
 * Ask the way every MCP caller did before cards existed: without `end_user_cards`.
 * @param client - The MCP client.
 */
async function askWithoutCards(client: Client): Promise<Reply & { cards?: Card[] }> {
  return parse<Reply & { cards?: Card[] }>(await client.callTool({ name: 'ask_workspace', arguments: { message: 'Open a ticket for the refund', agent_slug: 'revenue-lead' } }) as ToolResult);
}

/**
 * The card runs stored on the conversation's assistant message.
 * @param conversationId
 */
async function storedCardsOf(conversationId: number) {
  const messages = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, conversationId));
  return messages.flatMap(message => message.runsJson ?? []).filter(run => run.type === 'card');
}

describe('ask_workspace without end_user_cards', () => {
  it('files the card to Review and returns no cards key, exactly as before cards existed', async () => {
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      const out = await askWithoutCards(client);

      expect(out).not.toHaveProperty('cards');
      expect(out.actions).toHaveLength(1);
      expect(await db.select().from(actionRunSchema)).toHaveLength(1);

      const [stored] = await storedCardsOf(out.conversationId);

      expect(stored).toMatchObject({ label: 'Open a ticket', state: expect.stringMatching(/^(filed|decided)$/) });
      expect(stored).not.toHaveProperty('endUser');
    } finally {
      await server.close();
    }
  });

  it('tells the agent there are no cards to tap, and says nothing of a button', async () => {
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      await askWithoutCards(client);
      const sent = (runAgentDeep.mock.calls[0]![0] as { message: string }).message;

      expect(sent).toContain('no cards to tap');
      expect(sent).not.toContain('button');
    } finally {
      await server.close();
    }
  });

  it('tells the agent a card comes back as a button when end_user_cards is true', async () => {
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      await askForCard(client);
      const sent = (runAgentDeep.mock.calls[0]![0] as { message: string }).message;

      expect(sent).toContain('comes back to the caller as a button');
      expect(sent).not.toContain('no cards to tap');
    } finally {
      await server.close();
    }
  });

  it('keeps filing every card to Review on an assistant turn, even when end user cards are asked for', async () => {
    scriptedCardTurn(completeInput);
    const out = await askWorkspace({ orgId: ORG, message: 'Open a ticket', actorId: 'token:t1', agentSlug: 'revenue-lead', surface: 'assistant', endUserCards: true });

    expect(out).not.toHaveProperty('cards');
    expect(await db.select().from(actionRunSchema)).toHaveLength(1);
    expect(await storedCardsOf(out.conversationId)).not.toContainEqual(expect.objectContaining({ endUser: true }));
  });
});

describe('ask_workspace cards', () => {
  it('hands the caller a card, with an id to tap, for a registered, enabled action with whole input', async () => {
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      const out = await askForCard(client);

      expect(out.cards).toHaveLength(1);
      expect(out.cards[0]).toMatchObject({ label: 'Open a ticket', actionId: CARD_ACTION_ID, input: completeInput });
      expect(out.cards[0]!.id).toMatch(/\S/);
      expect(out.cards[0]!.draft).toBeUndefined();
      // Not filed for review: a tap runs it, as the caller's user.
      expect(await db.select().from(actionRunSchema)).toHaveLength(0);
      // Marked on the stored card: only a card minted for an end user can be run.
      expect(await storedCardsOf(out.conversationId)).toContainEqual(expect.objectContaining({ id: out.cards[0]!.id, endUser: true }));
    } finally {
      await server.close();
    }
  });

  it('puts up a draft card, not a runnable one, when the input is not whole', async () => {
    scriptedCardTurn({ topic: 'refund' });
    const { client, server } = await setup();
    try {
      const out = await askForCard(client);

      expect(out.cards).toHaveLength(1);
      expect(out.cards[0]!.draft?.missing).toContain('summary');
    } finally {
      await server.close();
    }
  });

  it('leaves out a card for an action no end user may run', async () => {
    scriptedCardTurn({ note: 'x' }, 'no.such_action');
    const { client, server } = await setup();
    try {
      expect((await askForCard(client)).cards).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('files a card for an action that sets both cardRunnable and ownsDedupKey to Review with no end-user marker, so a tap on it is CARD_NOT_FOUND', async () => {
    scriptedCardTurn(completeInput, OWNS_KEY_ACTION_ID);
    const { client, server } = await setup();
    try {
      const out = await askForCard(client);
      const [stored] = await storedCardsOf(out.conversationId);

      expect(out.cards).toEqual([]);
      expect(await db.select().from(actionRunSchema)).toHaveLength(1);
      expect(stored).toMatchObject({ actionId: OWNS_KEY_ACTION_ID });
      expect(stored).not.toHaveProperty('endUser');
      expect(stored).not.toHaveProperty('id');

      const tap = (await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: out.conversationId, card_id: 'card_1', caller: tapper } })) as ToolResult;

      expect(tap.isError).toBe(true);
      expect(text(tap)).toMatch(/^CARD_NOT_FOUND/);
      expect(cardActionRuns).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('keeps the error text of a failed card check out of the message a later tap gets', async () => {
    failingCardCheck.mockImplementation(() => {
      throw new Error('connect ECONNREFUSED 10.0.3.7:5432 (internal db host)');
    });
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      const out = await askForCard(client);

      expect(out.cards).toEqual([]);

      // The app never sees an unfiled card's id, but a tap that guesses it must still get a safe message.
      const [stored] = await storedCardsOf(out.conversationId);
      const tap = (await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: out.conversationId, card_id: stored!.id as string, caller: tapper } })) as ToolResult;

      expect(stored).toMatchObject({ state: 'unfiled' });
      expect(tap.isError).toBe(true);
      expect(text(tap)).toMatch(/^CARD_NOT_AVAILABLE/);
      expect(text(tap)).not.toMatch(/ECONNREFUSED|10\.0\.3\.7|internal db host/);
      expect(cardActionRuns).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('leaves out a card for an action the workspace turned off', async () => {
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: CARD_ACTION_ID, rung: 'observe', riskTier: 'low' });
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      expect((await askForCard(client)).cards).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('leaves out a card whose input tries to name the caller', async () => {
    scriptedCardTurn({ ...completeInput, caller: { id: 'x', name: 'Forged', email: 'forged@example.com' } });
    const { client, server } = await setup();
    try {
      expect((await askForCard(client)).cards).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

describe('ask_workspace cards and the time limit', () => {
  it('returns a card recommended before the cut, and files one recommended after it to Review', async () => {
    vi.stubEnv('VOCION_CHAT_TURN_LIMIT_MS', '50');
    let recommendLate!: () => void;
    const lateGate = new Promise<void>((resolve) => {
      recommendLate = resolve;
    });
    runAgentDeep.mockImplementation(async (opts: { onEvent?: (e: unknown) => void }) => {
      opts.onEvent?.({ type: 'response_delta', delta: 'Half an answer' });
      opts.onEvent?.({ type: 'recommended_action', recommendation: { label: 'Early ticket', actionId: CARD_ACTION_ID, input: completeInput } });
      await lateGate;
      opts.onEvent?.({ type: 'recommended_action', recommendation: { label: 'Late ticket', actionId: CARD_ACTION_ID, input: completeInput } });
      opts.onEvent?.({ type: 'response_delta', delta: ', and the rest.' });
      opts.onEvent?.({ type: 'done', response: 'Half an answer, and the rest.', traceId: 't' });
      return { response: 'Half an answer, and the rest.', traceId: 't', toolCalls: [] };
    });
    const { client, server } = await setup();
    try {
      const out = await askForCard(client);

      expect(out.truncated).toBe(true);
      // The card up before the cut is handed back to tap, and nothing is filed for it.
      expect(out.cards.map(card => card.label)).toEqual(['Early ticket']);
      expect(await db.select().from(actionRunSchema)).toHaveLength(0);

      recommendLate();
      // The continuation waits on the filing before it writes the rest of the
      // answer, as it did before cards existed, so once that row is there the
      // late card is already on Review.
      await vi.waitFor(async () => {
        const rows = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, out.conversationId));

        expect(rows.at(-1)!.status).toBe('continued');
      });
      const filed = await db.select().from(actionRunSchema);

      expect(filed).toHaveLength(1);
      expect(filed[0]!.actionId).toBe(CARD_ACTION_ID);
    } finally {
      vi.unstubAllEnvs();
      await server.close();
    }
  });
});

describe('run_workspace_card', () => {
  it('leaves a tap waiting for a workspace person at the default rung: the app is told pending, and nothing ran', async () => {
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      const asked = await askForCard(client);
      const tapped = parse<{ status: string; outcome: string; runId: number }>(await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: asked.conversationId, card_id: asked.cards[0]!.id, caller: tapper } }) as ToolResult);
      const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, tapped.runId));

      expect(tapped).toMatchObject({ status: 'pending', outcome: 'created' });
      expect(run).toMatchObject({ status: 'pending' });
      expect(cardActionRuns).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('runs the tapped card as the caller the app supplied, and records the run, where the workspace lets an agent act on its own', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: CARD_ACTION_ID, threshold: 0.5, enabled: 'true' });
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: CARD_ACTION_ID, rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.5, source: 'trust.yaml' });
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      const asked = await askForCard(client);
      const tapped = parse<{ status: string; actionId: string; runId: number; result: { ticketFor: string } }>(await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: asked.conversationId, card_id: asked.cards[0]!.id, caller: tapper } }) as ToolResult);

      expect(tapped).toMatchObject({ status: 'done', actionId: CARD_ACTION_ID, result: { ticketFor: 'dana@example.com' } });
      expect(cardActionRuns).toEqual([{ input: completeInput, caller: tapper }]);

      const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, tapped.runId));

      expect(run).toMatchObject({ orgId: ORG, actionId: CARD_ACTION_ID });
    } finally {
      await server.close();
    }
  });

  it('refuses a tap that would run at once on a paused workspace with WORKSPACE_PAUSED and leaves its run pending, and a tap after resume refreshes that run instead of running it', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: CARD_ACTION_ID, threshold: 0.5, enabled: 'true' });
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: CARD_ACTION_ID, rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.5, source: 'trust.yaml' });
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      const asked = await askForCard(client);
      const tapArguments = { conversation_id: asked.conversationId, card_id: asked.cards[0]!.id, caller: tapper };
      await db.update(projectSchema).set({ pausedAt: new Date(), pausedBy: 'token:t9', pausedNote: 'billing review' }).where(eq(projectSchema.id, ORG));
      const paused = (await client.callTool({ name: 'run_workspace_card', arguments: tapArguments })) as ToolResult;
      const [left] = await db.select().from(actionRunSchema);

      expect(paused.isError).toBe(true);
      expect(text(paused)).toMatch(/^WORKSPACE_PAUSED: the card did not run, and your request is kept\./);
      // The pause note and who paused it are for the workspace's people, never the outside app.
      expect(text(paused)).not.toContain('billing review');
      expect(text(paused)).not.toContain('t9');
      expect(text(paused)).not.toMatch(/UTC|Paused by/);
      expect(cardActionRuns).toHaveLength(0);
      // What the refused tap leaves: one run, not executed, waiting; and a card with no run or decision recorded on it.
      expect(left).toMatchObject({ status: 'pending', executedAt: null });

      const [card] = await storedCardsOf(asked.conversationId);

      expect(card).toMatchObject({ id: asked.cards[0]!.id });
      expect(card).not.toHaveProperty('runId');
      expect(card).not.toHaveProperty('decision');

      await db.update(projectSchema).set({ pausedAt: null, pausedBy: null, pausedNote: null }).where(eq(projectSchema.id, ORG));
      const resumed = parse<{ status: string; outcome: string; runId: number }>(await client.callTool({ name: 'run_workspace_card', arguments: tapArguments }) as ToolResult);

      expect(resumed).toMatchObject({ status: 'pending', outcome: 'refreshed', runId: left!.id });
      expect(cardActionRuns).toHaveLength(0);
      expect(await db.select().from(actionRunSchema)).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('refuses a second end user on a card the first left waiting, and the waiting run keeps the first caller', async () => {
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      const asked = await askForCard(client);
      const tapOf = (who: typeof tapper) => ({ name: 'run_workspace_card', arguments: { conversation_id: asked.conversationId, card_id: asked.cards[0]!.id, caller: who } });
      const first = parse<{ runId: number }>(await client.callTool(tapOf(tapper)) as ToolResult);
      const refused = (await client.callTool(tapOf({ id: 'app-user-77', name: 'Sam Ortiz', email: 'sam@example.com' }))) as ToolResult;
      const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, first.runId));

      expect(refused.isError).toBe(true);
      expect(text(refused)).toMatch(/^CARD_NOT_AVAILABLE/);
      expect(run!.proposal).toMatchObject({ origin: { caller: tapper } });
    } finally {
      await server.close();
    }
  });

  it('refuses a caller with a bad email, and an unknown card, with a typed error and nothing run', async () => {
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      const asked = await askForCard(client);
      const badCaller = (await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: asked.conversationId, card_id: asked.cards[0]!.id, caller: { ...tapper, email: 'nope' } } })) as ToolResult;
      const unknown = (await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: asked.conversationId, card_id: 'card_nope', caller: tapper } })) as ToolResult;

      expect(badCaller.isError).toBe(true);
      expect(unknown.isError).toBe(true);
      expect(text(unknown)).toMatch(/^CARD_NOT_FOUND/);
      expect(cardActionRuns).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('answers an unexpected server error with fixed text, never the error\'s own text', async () => {
    scriptedCardTurn(completeInput);
    const loggedErrors: unknown[][] = [];
    const logSpy = vi.spyOn(logger, 'error').mockImplementation((...args: unknown[]) => {
      loggedErrors.push(args);
    });
    onTestFinished(() => logSpy.mockRestore());
    const { client, server } = await setup();
    try {
      const asked = await askForCard(client);
      // What a database error looks like: SQL, the card input and the caller.
      failingCardRun.mockImplementationOnce(() => {
        throw new Error('insert into "action_run" values ($1) - params: {"email":"jo@example.com"} - duplicate key');
      });
      const tap = (await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: asked.conversationId, card_id: asked.cards[0]!.id, caller: tapper } })) as ToolResult;

      expect(tap.isError).toBe(true);
      expect(text(tap)).toBe(`INTERNAL_ERROR: ${CARD_INTERNAL_ERROR_MESSAGE}`);
      expect(text(tap)).not.toMatch(/action_run|jo@example\.com/);
      // The real error isn't lost: the server log keeps it for whoever debugs the tap.
      expect(loggedErrors).toContainEqual(['run_workspace_card failed unexpectedly', expect.objectContaining({ cardId: asked.cards[0]!.id, error: expect.stringContaining('duplicate key') })]);
    } finally {
      await server.close();
    }
  });

  it('refuses a card from a conversation another workspace holds', async () => {
    await db.insert(conversationSchema).values({ orgId: 'org_other', agentSlug: 'x', title: 'theirs' });
    const [theirs] = await db.select().from(conversationSchema).where(eq(conversationSchema.orgId, 'org_other'));
    const { client, server } = await setup();
    try {
      const out = (await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: theirs!.id, card_id: 'card_1', caller: tapper } })) as ToolResult;

      expect(out.isError).toBe(true);
      expect(text(out)).toMatch(/^CONVERSATION_NOT_FOUND/);
      expect(cardActionRuns).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('refuses a card whose action the workspace turned off after it was shown', async () => {
    scriptedCardTurn(completeInput);
    const { client, server } = await setup();
    try {
      const asked = await askForCard(client);
      await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: CARD_ACTION_ID, rung: 'observe', riskTier: 'low' });
      const out = (await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: asked.conversationId, card_id: asked.cards[0]!.id, caller: tapper } })) as ToolResult;

      expect(out.isError).toBe(true);
      expect(text(out)).toMatch(/^ACTION_DISABLED/);
      expect(cardActionRuns).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('refuses a draft card until the agent has drafted it', async () => {
    scriptedCardTurn({ topic: 'refund' });
    const { client, server } = await setup();
    try {
      const asked = await askForCard(client);
      const out = (await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: asked.conversationId, card_id: asked.cards[0]!.id, caller: tapper } })) as ToolResult;

      expect(out.isError).toBe(true);
      expect(text(out)).toMatch(/^CARD_NEEDS_DRAFT/);
      expect(cardActionRuns).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('refuses a token that does not hold the action\'s grant', async () => {
    scriptedCardTurn(completeInput);
    const first = await setup();
    let asked: CardReply;
    try {
      asked = await askForCard(first.client);
    } finally {
      await first.server.close();
    }
    const server = await buildServer(config, { userId: 'token:t2', principal: { kind: 'user', id: 'token:t2', scope: { orgId: ORG }, grants: [] } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const out = (await client.callTool({ name: 'run_workspace_card', arguments: { conversation_id: asked.conversationId, card_id: asked.cards[0]!.id, caller: tapper } })) as ToolResult;

      expect(out.isError).toBe(true);
      expect(text(out)).toMatch(/^FORBIDDEN/);
      expect(cardActionRuns).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});

/**
 * A conversation in the test workspace with the end user's message in it.
 * @param content - What the end user said.
 */
async function conversationWith(content: string): Promise<number> {
  const conversation = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: 'token:t1', surface: 'mcp' });
  await appendMessage({ orgId: ORG, conversationId: conversation.id, role: 'user', content });
  return conversation.id;
}

/**
 * Script the writer's model to answer every write with these tool arguments.
 * @param args - The `write_request` arguments.
 */
function scriptWriter(args: Record<string, unknown>) {
  const invoke = vi.fn().mockResolvedValue({ tool_calls: [{ name: 'write_request', args }] });
  requestWriterModel.mockReturnValue({ bindTools: () => ({ invoke }) });
  return invoke;
}

describe('talk_to_a_person', () => {
  it('writes the request from the conversation and runs it as the caller the app supplied, where the workspace lets an agent act on its own', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: CARD_ACTION_ID, threshold: 0.5, enabled: 'true' });
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: CARD_ACTION_ID, rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.5, source: 'trust.yaml' });
    const conversationId = await conversationWith('My order arrived damaged and I want a refund.');
    const invoke = scriptWriter(completeInput);
    const { client, server } = await setup();
    try {
      const tapped = parse<{ status: string; actionId: string; runId: number; result: { ticketFor: string } }>(await client.callTool({ name: 'talk_to_a_person', arguments: { conversation_id: conversationId, action_id: CARD_ACTION_ID, caller: tapper } }) as ToolResult);

      expect(tapped).toMatchObject({ status: 'done', actionId: CARD_ACTION_ID, result: { ticketFor: 'dana@example.com' } });
      expect(cardActionRuns).toEqual([{ input: completeInput, caller: tapper }]);
      // The writer was shown what the end user said.
      expect(JSON.stringify(invoke.mock.calls[0])).toContain('arrived damaged');
    } finally {
      await server.close();
    }
  });

  it('refuses with REQUEST_NOT_WRITTEN and opens nothing when neither write is usable', async () => {
    const conversationId = await conversationWith('I need help.');
    const invoke = scriptWriter({ topic: 'refund' });
    const { client, server } = await setup();
    try {
      const out = (await client.callTool({ name: 'talk_to_a_person', arguments: { conversation_id: conversationId, action_id: CARD_ACTION_ID, caller: tapper } })) as ToolResult;

      expect(out.isError).toBe(true);
      expect(text(out)).toBe(`REQUEST_NOT_WRITTEN: ${REQUEST_NOT_WRITTEN_MESSAGE}`);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(await db.select().from(actionRunSchema)).toHaveLength(0);
      expect(cardActionRuns).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('refuses an action no end user may run with ACTION_NOT_RUNNABLE, before writing anything', async () => {
    const conversationId = await conversationWith('I need help.');
    const invoke = scriptWriter(completeInput);
    const { client, server } = await setup();
    try {
      const out = (await client.callTool({ name: 'talk_to_a_person', arguments: { conversation_id: conversationId, action_id: OWNS_KEY_ACTION_ID, caller: tapper } })) as ToolResult;

      expect(out.isError).toBe(true);
      expect(text(out)).toMatch(/^ACTION_NOT_RUNNABLE/);
      expect(invoke).not.toHaveBeenCalled();
      expect(cardActionRuns).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('refuses a tap that would run at once on a paused workspace with WORKSPACE_PAUSED, keeps the request waiting, and runs nothing', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: CARD_ACTION_ID, threshold: 0.5, enabled: 'true' });
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: CARD_ACTION_ID, rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.5, source: 'trust.yaml' });
    const conversationId = await conversationWith('My order arrived damaged and I want a refund.');
    scriptWriter(completeInput);
    await db.update(projectSchema).set({ pausedAt: new Date(), pausedBy: 'token:t9', pausedNote: 'billing review' }).where(eq(projectSchema.id, ORG));
    const { client, server } = await setup();
    try {
      const out = (await client.callTool({ name: 'talk_to_a_person', arguments: { conversation_id: conversationId, action_id: CARD_ACTION_ID, caller: tapper } })) as ToolResult;
      const rows = await db.select().from(actionRunSchema);

      expect(out.isError).toBe(true);
      expect(text(out)).toBe(`WORKSPACE_PAUSED: ${PAUSED_TALK_MESSAGE}`);
      expect(text(out)).not.toContain('billing review');
      expect(cardActionRuns).toHaveLength(0);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'pending', executedAt: null });
    } finally {
      await server.close();
    }
  });

  it('answers an unexpected failure with fixed text, and logs where it failed without its message, which can quote the end user', async () => {
    const loggedErrors: unknown[][] = [];
    const logSpy = vi.spyOn(logger, 'error').mockImplementation((...args: unknown[]) => loggedErrors.push(args));
    onTestFinished(() => logSpy.mockRestore());
    const conversationId = await conversationWith('I need help.');
    failingTalk.mockRejectedValueOnce(new Error('insert into "action_run" values ($1) - params: {"email":"jo@example.com"} - duplicate key'));
    const { client, server } = await setup();
    try {
      const out = (await client.callTool({ name: 'talk_to_a_person', arguments: { conversation_id: conversationId, action_id: CARD_ACTION_ID, caller: tapper } })) as ToolResult;

      expect(out.isError).toBe(true);
      expect(text(out)).toBe(`INTERNAL_ERROR: ${TALK_INTERNAL_ERROR_MESSAGE}`);
      expect(text(out)).not.toMatch(/action_run|jo@example\.com/);
      expect(loggedErrors).toContainEqual(['talk_to_a_person failed unexpectedly', expect.objectContaining({ conversationId, kind: 'Error', frames: expect.stringContaining('at ') })]);
      // The message quotes what was being written, so it never reaches the log either.
      expect(JSON.stringify(loggedErrors)).not.toMatch(/jo@example\.com|duplicate key/);
    } finally {
      await server.close();
    }
  });
});
