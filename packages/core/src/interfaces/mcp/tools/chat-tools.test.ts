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
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));

const runAgentDeep = vi.fn();
vi.mock('@/services/AgentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/AgentService')>();
  return { ...actual, runAgentDeep: (...args: unknown[]) => runAgentDeep(...args) };
});
vi.mock('@/services/BudgetService', () => ({
  preflightCheck: vi.fn(async () => ({ ok: true })),
  chargeUsage: vi.fn(async () => {}),
}));

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { agentSchema, conversationMessageSchema, conversationSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { buildServer } = await import('../server');

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
  runAgentDeep.mockReset();
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
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
      const out = parse<Reply>(await client.callTool({ name: 'ask_workspace', arguments: { message: 'What does the wiki say about our house voice?' } }) as ToolResult);

      expect(out).toMatchObject({ reply: 'The house voice is on /wiki/voice.md.', truncated: false, agentSlug: 'wiki-researcher', agentName: 'Wiki researcher' });
      expect(out.routing).toMatchObject({ chosen: 'wiki-researcher', defaulted: false });
      expect(out.routing!.reason).toMatch(/wiki-researcher matched handles: wiki/);
      // The inactive agent handled "wiki" too and was never a candidate.
      expect(out.routing!.candidates.map(c => c.slug)).not.toContain('retired-agent');
      expect(out.url).toBe(`/w/northwind/dashboard/chat/${out.conversationId}`);

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

  it('defaults to the workspace lead when nothing matches, and says so', async () => {
    scriptedTurn('Good morning.');
    const { client, server } = await setup();
    try {
      const out = parse<Reply>(await client.callTool({ name: 'ask_workspace', arguments: { message: 'Good morning, how are things?' } }) as ToolResult);

      expect(out.agentSlug).toBe('revenue-lead');
      expect(out.routing).toMatchObject({ chosen: 'revenue-lead', defaulted: true });
      expect(out.routing!.reason).toMatch(/workspace lead answers/);
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
