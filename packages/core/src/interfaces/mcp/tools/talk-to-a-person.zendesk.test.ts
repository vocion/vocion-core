import type { McpConfig } from '../config';
/**
 * The no-card "Talk to a person" path, whole: the MCP tool `talk_to_a_person`
 * (in-memory transport) -> `talkToAPerson` writes the ticket's words with the
 * model -> `proposeEndUserRun` -> the REAL `zendesk.create_ticket` action ->
 * `handOffToTicket` -> the Zendesk client, against a real (PGlite) database.
 * Only two things on that path are faked: the model (a scripted writer) and
 * Zendesk's network (`FakeZendesk` behind a stubbed global `fetch`, since the
 * action passes the client no deps). Off the path, adoption tracking and the
 * budget service are stubbed no-ops, as in chat-tools.test.ts. The credential
 * is read from the real credential tables; only the vault's cipher key is a
 * fixed test key.
 */
import type { Answer } from '@/libs/zendesk/fakeZendesk';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

let testDekId = 0;
const VAULT_TEST_KEY = Buffer.alloc(32, 9);

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/BudgetService', () => ({
  preflightCheck: vi.fn(async () => ({ ok: true })),
  chargeUsage: vi.fn(async () => {}),
}));
// The credential vault with a fixed AES key, so a stored credential round-trips without env key material.
vi.mock('@/libs/crypto/credentialVault', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/crypto/credentialVault')>();
  return {
    ...actual,
    buildCredentialVault: () => ({
      kind: 'local' as const,
      async encrypt(_orgId: string, plaintext: Buffer) {
        const { ciphertext, nonce, authTag } = actual.aesEncrypt(VAULT_TEST_KEY, plaintext);
        return { ciphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), authTag: authTag.toString('base64'), dekId: testDekId };
      },
      async decrypt(_orgId: string, ciphertext: string, nonce: string, authTag: string) {
        return actual.aesDecrypt(VAULT_TEST_KEY, Buffer.from(ciphertext, 'base64'), Buffer.from(nonce, 'base64'), Buffer.from(authTag, 'base64'));
      },
    }),
  };
});
// The model the writer calls: scripted per test. Every other `@/libs/llm` export stays real.
const writerModel = vi.hoisted(() => vi.fn());
vi.mock('@/libs/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/llm')>();
  return { ...actual, buildChatModelForOrg: () => writerModel() };
});

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { FakeZendesk, tokenAnswer } = await import('@/libs/zendesk/fakeZendesk');
const { actionRunSchema, agentSchema, autonomyPolicySchema, conversationMessageSchema, conversationSchema, knowledgeSourceSchema, projectSchema, sourceCredentialSchema, sourceDekSchema, sourceInstallSchema, tenantAccountSchema, ticketHandoffSchema, trustRuleSchema } = await import('@/models/Schema');
const { appendMessage, createConversation } = await import('@/services/ConversationService');
const { ensureInstall, storeCredential } = await import('@/services/SourceCredentialService');
const { TALK_RUN_RETRYABLE_MESSAGE } = await import('@/services/chat/talkToAPerson');
const { buildServer } = await import('../server');

const ORG = 'org_talk_zendesk';
const ACTION_ID = 'zendesk.create_ticket';
const TOKENS = '/oauth/tokens';
const SEARCH = '/api/v2/users/search';
const TICKETS = '/api/v2/tickets';
const CLIENT_SECRET = 'fixture-secret-0001';
const CALLER = { id: 'app-user-42', name: 'Dana Reyes', email: 'dana@example.com' };
const WRITTEN_TICKET = { subject: 'Card stopped charging', summary: 'Dana says the card stopped charging after Tuesday\'s update and she wants a person to look.', topic: 'Billing' };
const scratchDir = mkdtempSync(join(tmpdir(), 'cc-talk-zendesk-'));

const config: McpConfig = {
  orgId: ORG,
  contextPath: scratchDir,
  diskWorkspace: true,
  autoCommit: false,
  autoApply: false,
  serverName: 'vocion-test',
  serverVersion: '0.0.0',
};

type ToolResult = { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

/** What the tool answers for a Talk to a person tap on a ticket. */
type TapAnswer = {
  status: string;
  outcome?: string;
  runId: number;
  actionId: string;
  result: { ticketId?: number; requestUrl?: string; created?: boolean } | null;
  error?: string;
  retryable?: boolean;
};

let clientCount = 0;

/** Connect an MCP client to a fresh server for the test token; closed when the test ends. */
async function connectClient(): Promise<Client> {
  const server = await buildServer(config, { userId: 'token:t1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  onTestFinished(() => server.close());
  return client;
}

/**
 * The text of a tool result.
 * @param result - What `callTool` returned.
 */
function textOf(result: ToolResult): string {
  return result.content?.find(part => part.type === 'text')?.text ?? '';
}

/**
 * Tap Talk to a person for the Zendesk ticket action.
 * @param client - The MCP client.
 * @param conversationId - The conversation the app started.
 * @returns The raw text (to search for leaks) and the parsed answer.
 */
async function tapTalkToAPerson(client: Client, conversationId: number): Promise<{ raw: string; answer: TapAnswer }> {
  const out = (await client.callTool({ name: 'talk_to_a_person', arguments: { conversation_id: conversationId, action_id: ACTION_ID, caller: CALLER } })) as ToolResult;
  if (out.isError) {
    throw new Error(textOf(out));
  }
  return { raw: textOf(out), answer: JSON.parse(textOf(out)) as TapAnswer };
}

/**
 * A conversation the calling app started over MCP, with the end user's message in it.
 * @param content - What the end user said.
 */
async function conversationWith(content: string): Promise<number> {
  const conversation = await createConversation({ orgId: ORG, agentSlug: 'support-lead', createdBy: 'token:t1', surface: 'mcp' });
  await appendMessage({ orgId: ORG, conversationId: conversation.id, role: 'user', content });
  return conversation.id;
}

/**
 * Script the writer's model to answer every write with these ticket words.
 * @param args - The `write_request` arguments.
 * @returns The model's `invoke`, to count writes.
 */
function scriptWriter(args: Record<string, unknown>) {
  const invoke = vi.fn().mockResolvedValue({ tool_calls: [{ name: 'write_request', args }] });
  writerModel.mockReturnValue({ bindTools: () => ({ invoke }) });
  return invoke;
}

/**
 * A fake Zendesk that already knows the caller as an end user, with these answers for the tickets path.
 * @param tickets - The tickets path's answers in the order they are asked: a lookup by external id, then the create, and so on.
 */
function zendeskWithTickets(tickets: Answer[]): InstanceType<typeof FakeZendesk> {
  return new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [SEARCH]: [{ status: 200, body: { users: [{ id: 501, role: 'end-user' }] } }], [TICKETS]: tickets });
}

/**
 * Send the action client's global `fetch` to the fake, since the action passes no deps.
 * @param fake - The fake Zendesk.
 */
function routeFetchTo(fake: InstanceType<typeof FakeZendesk>): void {
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => fake.send(url, init));
}

/**
 * The ticket creates (POSTs) the fake received.
 * @param fake - The fake Zendesk.
 */
function createsSentTo(fake: InstanceType<typeof FakeZendesk>) {
  return fake.sentTo(TICKETS).filter(call => call.init.method === 'POST');
}

/**
 * The body of a request the fake received, parsed.
 * @param call - The recorded request.
 * @param call.init - Its init, whose body is JSON.
 */
function bodyOf(call: { init: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

/**
 * The Idempotency-Key header a request the fake received carried; Zendesk
 * drops a replayed create that repeats it.
 * @param call - The recorded request.
 * @param call.init - Its init, whose headers are a plain object.
 */
function idempotencyKeyOf(call: { init: RequestInit }): string | undefined {
  return (call.init.headers as Record<string, string>)['idempotency-key'];
}

/**
 * The ticket answer Zendesk gives for a created ticket.
 * @param id - The new ticket's id.
 */
function createdAnswer(id: number): Answer {
  return { status: 201, body: { ticket: { id, status: 'new' } } };
}

/** Delete every row these tests write, children first. */
async function clearRows(): Promise<void> {
  await db.delete(ticketHandoffSchema);
  await db.delete(actionRunSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(trustRuleSchema);
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(agentSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  await db.delete(sourceDekSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
}

/** The workspace: an agent, the zendesk source with its settings and credential, and the rung that lets the ticket open on its own. */
async function seedWorkspace(): Promise<void> {
  await db.insert(tenantAccountSchema).values({ id: 'acct_talk_zendesk', name: 'Northwind', slug: 'northwind' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_talk_zendesk', slug: 'northwind', name: 'Northwind' });
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'support-lead', name: 'Support lead', systemPrompt: 'You lead support.', description: 'Answers customers.', handles: ['support'] });
  await db.insert(knowledgeSourceSchema).values({
    orgId: ORG,
    slug: 'zendesk',
    configJson: {
      tickets: { topicTags: { billing: 'billing_queue' }, fallbackTopicTag: 'else', tags: ['vocion-dev'], subjectPrefix: '[TEST]' },
      helpCenter: { host: 'https://help.example.com', locale: 'en-us' },
    },
  });
  const [dek] = await db.insert(sourceDekSchema).values({ orgId: ORG, wrappedDek: 'test', algorithm: 'AES_256_GCM' }).returning({ id: sourceDekSchema.id });
  testDekId = dek!.id;
  // A client no other test used, so the Zendesk client's token cache starts empty.
  clientCount += 1;
  const installId = await ensureInstall(ORG, 'zendesk');
  await storeCredential({ orgId: ORG, installId, displayName: 'zendesk credential', raw: { subdomain: 'acme', clientId: `vocion-talk-test-${clientCount}`, clientSecret: CLIENT_SECRET } });
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: ACTION_ID, threshold: 0.5, enabled: 'true' });
  await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: ACTION_ID, rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.5, source: 'trust.yaml' });
}

/**
 * The conversation's hand-off row.
 * @param conversationId - The conversation.
 */
async function handoffFor(conversationId: number) {
  const [row] = await db.select().from(ticketHandoffSchema).where(eq(ticketHandoffSchema.conversationId, conversationId));
  return row;
}

beforeEach(async () => {
  writerModel.mockReset();
  await clearRows();
  await seedWorkspace();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await clearRows();
  rmSync(scratchDir, { recursive: true, force: true });
});

describe('talk_to_a_person with zendesk.create_ticket, MCP tool to Zendesk HTTP', () => {
  it('one tap opens one ticket for the app\'s caller, with the model\'s words, the prefix, the topic\'s tag and the conversation\'s external id, and never shows the client secret', async () => {
    const conversationId = await conversationWith('My card stopped charging after Tuesday\'s update. Can a person look?');
    const invoke = scriptWriter(WRITTEN_TICKET);
    const fake = zendeskWithTickets([{ status: 200, body: { tickets: [] } }, createdAnswer(42)]);
    routeFetchTo(fake);
    const client = await connectClient();

    const { raw, answer } = await tapTalkToAPerson(client, conversationId);

    expect(answer).toMatchObject({ status: 'done', actionId: ACTION_ID, result: { ticketId: 42, created: true, requestUrl: 'https://help.example.com/hc/en-us/requests/42' } });
    expect(raw).not.toContain(CLIENT_SECRET);
    expect(invoke).toHaveBeenCalledTimes(1);

    const creates = createsSentTo(fake);

    expect(creates).toHaveLength(1);

    const handoff = await handoffFor(conversationId);

    expect(bodyOf(creates[0]!)).toEqual({
      ticket: {
        subject: '[TEST] Card stopped charging',
        comment: { body: WRITTEN_TICKET.summary },
        requester_id: 501,
        status: 'new',
        tags: ['billing_queue', 'vocion-dev'],
        external_id: `vocion-handoff-${handoff!.idempotencyKey}`,
      },
    });
    expect(idempotencyKeyOf(creates[0]!)).toBe(handoff!.idempotencyKey);
    // The requester is looked up by the app's id for the caller, never anything the model wrote.
    expect(fake.sentTo(SEARCH).map(call => new URL(call.url).searchParams.get('external_id'))).toEqual([CALLER.id]);
    expect(handoff).toMatchObject({ orgId: ORG, conversationId, callerId: CALLER.id, ticketId: 42, status: 'open' });
  });

  it('a repeat tap by the same end user writes nothing new, creates nothing, and answers with the same run, whose ticket is the one already open', async () => {
    const conversationId = await conversationWith('My card stopped charging.');
    const invoke = scriptWriter(WRITTEN_TICKET);
    const fake = zendeskWithTickets([{ status: 200, body: { tickets: [] } }, createdAnswer(42)]);
    routeFetchTo(fake);
    const client = await connectClient();

    const first = await tapTalkToAPerson(client, conversationId);
    const second = await tapTalkToAPerson(client, conversationId);

    expect(first.answer).toMatchObject({ status: 'done', result: { ticketId: 42 } });
    // A finished run's repeat tap answers with that same run and `already_decided`; the action service hands back its status, not its result (workspaceCards.ts RunWorkspaceCardResult.result).
    expect(second.answer).toMatchObject({ status: 'done', outcome: 'already_decided', runId: first.answer.runId, result: null });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(createsSentTo(fake)).toHaveLength(1);

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.actionId, ACTION_ID));

    expect(run).toMatchObject({ id: first.answer.runId, status: 'done', result: { ticketId: 42, requestUrl: 'https://help.example.com/hc/en-us/requests/42' } });
    expect(await db.select().from(ticketHandoffSchema).where(eq(ticketHandoffSchema.conversationId, conversationId))).toHaveLength(1);
  });

  it('a Zendesk 5xx on create gives the app the retryable message and opens no ticket, then Try again after recovery files exactly one ticket from the stored words without calling the model', async () => {
    const conversationId = await conversationWith('My card stopped charging.');
    const invoke = scriptWriter(WRITTEN_TICKET);
    // Lookup (none), create (503), then after recovery: lookup (none), create (201).
    const fake = zendeskWithTickets([{ status: 200, body: { tickets: [] } }, { status: 503 }, { status: 200, body: { tickets: [] } }, createdAnswer(43)]);
    routeFetchTo(fake);
    const client = await connectClient();

    const failed = await tapTalkToAPerson(client, conversationId);

    expect(failed.answer).toMatchObject({ status: 'failed', retryable: true, error: TALK_RUN_RETRYABLE_MESSAGE });
    expect(failed.raw).not.toContain(CLIENT_SECRET);
    expect((await handoffFor(conversationId))?.ticketId).toBeNull();

    // A new writer answer would show up in the body if the stored words were not reused.
    invoke.mockResolvedValue({ tool_calls: [{ name: 'write_request', args: { subject: 'Different words', summary: 'Written on the second tap.', topic: 'other' } }] });
    const retried = await tapTalkToAPerson(client, conversationId);

    expect(retried.answer).toMatchObject({ status: 'done', result: { ticketId: 43, created: true } });
    expect(invoke).toHaveBeenCalledTimes(1);

    const creates = createsSentTo(fake);

    expect(creates).toHaveLength(2);
    expect(bodyOf(creates[1]!)).toEqual(bodyOf(creates[0]!));
    // The replayed create carries the first one's key, so Zendesk can drop it if the first did land.
    expect(idempotencyKeyOf(creates[1]!)).toBe(idempotencyKeyOf(creates[0]!));
    expect(idempotencyKeyOf(creates[1]!)).toBe((await handoffFor(conversationId))!.idempotencyKey);
    expect(bodyOf(creates[1]!)).toMatchObject({ ticket: { subject: '[TEST] Card stopped charging' } });
    expect(await db.select().from(ticketHandoffSchema).where(eq(ticketHandoffSchema.conversationId, conversationId))).toHaveLength(1);
    expect((await handoffFor(conversationId))?.ticketId).toBe(43);
  });
});
