import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/outboundMcp/sources', () => ({ loadMcpSources: async () => [{ slug: 'factory', name: 'Factory', config: { readTools: ['ticket_status'], writeTools: ['post_journal'], actTools: ['request_ticket'] } }] }));
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: async () => ({}) }));
const sent = vi.hoisted(() => ({ args: [] as unknown[] }));
vi.mock('@/libs/outboundMcp/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/outboundMcp/client')>(),
  mcpCredentialsOf: () => ({}),
  withMcp: async (_credentials: unknown, fn: (client: unknown) => unknown) => fn({}),
  listMcpTools: async () => [{ name: 'request_ticket', inputSchema: { type: 'object', properties: { title: { type: 'string' }, origin: { type: 'object' } }, required: ['title'] } }],
  callMcpTool: async (_client: unknown, _remote: unknown, args: unknown) => {
    sent.args.push(args);
    return { structuredContent: { ticket: 'ACME-4', url: 'https://factory.example/t/ACME-4' } };
  },
}));
const { answerOf, mcpActAction, withOrigin } = await import('./mcp-act');
const { isNeverAuto, personDecidesEveryRun } = await import('./neverAuto');

const tool = (properties: Record<string, object>) => ({ inputSchema: { type: 'object' as const, properties } });

describe('mcp.act', () => {
  it('runs on the person\'s word: it never declares that a person decides every run', () => {
    expect(personDecidesEveryRun(mcpActAction)).toBe(false);
    expect(isNeverAuto(mcpActAction)).toBe(false);
    expect(mcpActAction.external).toBe(true);
    expect(mcpActAction.policyKeyFor?.({ sourceSlug: 'factory', tool: 'request_ticket', input: {}, summary: 's' })).toBe('mcp.act.factory.request_ticket');
  });

  it('adds the conversation and a stable filing id when the tool takes an origin, and keeps what the agent wrote', () => {
    const remote = tool({ title: { type: 'string' }, origin: { type: 'object' } });

    expect(withOrigin(remote, { title: 'Mic audio', origin: { by: 'Jamie', url: 'https://chat.example/p1' } }, { origin: { conversationId: 41 }, runId: 9 }))
      .toEqual({ title: 'Mic audio', origin: { by: 'Jamie', url: 'https://chat.example/p1', conversation: '41', request: 'action:9' } });
    // The conversation is ours to give: an agent's guess is replaced.
    expect(withOrigin(remote, { origin: { conversation: '7' } }, { origin: { conversationId: 41 } })).toEqual({ origin: { conversation: '41' } });
  });

  it('sends the arguments untouched when the tool takes no origin or no conversation asked', () => {
    expect(withOrigin(tool({ title: { type: 'string' } }), { title: 'x' }, { origin: { conversationId: 41 }, runId: 9 })).toEqual({ title: 'x' });
    expect(withOrigin(tool({ origin: { type: 'object' } }), { title: 'x' }, { runId: 9 })).toEqual({ title: 'x' });
  });

  it('hands the agent the provider\'s answer: the structured one, else its text', () => {
    expect(answerOf({ structuredContent: { ticket: 'ACME-4', url: 'https://factory.example/t/ACME-4' }, content: [{ type: 'text', text: 'ignored' }] })).toBe('{"ticket":"ACME-4","url":"https://factory.example/t/ACME-4"}');
    expect(answerOf({ content: [{ type: 'text', text: 'filed' }, { type: 'image' }] })).toBe('filed');
    expect(answerOf({})).toBe('');
  });

  it('takes only a declared act tool: a read or a reviewed write is refused at the door and again at execution', async () => {
    const base = { sourceSlug: 'factory', input: { title: 'x' }, summary: 'File it' };

    expect(await mcpActAction.precheck?.({ orgId: 'org' }, { ...base, tool: 'request_ticket' })).toBeUndefined();
    expect(await mcpActAction.precheck?.({ orgId: 'org' }, { ...base, tool: 'post_journal' })).toMatch(/not one of this source's act tools \(request_ticket\)/);
    await expect(mcpActAction.execute({ orgId: 'org', credentials: {} }, { ...base, tool: 'ticket_status' })).rejects.toThrow(/no longer enabled/);
    expect(await mcpActAction.precheck?.({ orgId: 'org' }, { ...base, tool: 'request_ticket', input: {} })).toMatch(/Invalid arguments/);
  });

  it('runs without a reviewer, sends where it was asked, and returns the answer for the agent to tell', async () => {
    sent.args.length = 0;
    const out = await mcpActAction.execute({ orgId: 'org', credentials: {}, runId: 12, origin: { conversationId: 41 } }, { sourceSlug: 'factory', tool: 'request_ticket', input: { title: 'Mic audio' }, summary: 'File it' });

    expect(sent.args).toEqual([{ title: 'Mic audio', origin: { conversation: '41', request: 'action:12' } }]);
    expect(out.advice).toBe('Factory answered: {"ticket":"ACME-4","url":"https://factory.example/t/ACME-4"}');
  });
});

describe('mcp_act, the tool', () => {
  it('is offered only when a source takes requests, and files the same proposal propose_action would', async () => {
    const proposed: unknown[] = [];
    vi.doMock('@/services/agents/tools/proposeAction', () => ({ runProposal: async (_ctx: unknown, req: unknown, opts: unknown) => {
      proposed.push([req, opts]);

      return 'done';
    } }));
    const { mcpTools } = await import('@/services/agents/tools/mcpDirect');
    const ctx = (actTools?: string[]) => ({ orgId: 'org', connectorSources: ['factory'], sourceKinds: { factory: 'mcp' }, mcpSources: [{ slug: 'factory', name: 'Factory', readTools: ['ticket_status'], perPerson: false, ...(actTools ? { actTools } : {}) }] }) as never;

    expect(mcpTools(ctx()).map(t => t.name)).toEqual(['mcp_list_tools', 'mcp_read']);

    const tools = mcpTools(ctx(['request_ticket']));
    const act = tools.find(t => t.name === 'mcp_act')!;

    expect(await act.invoke({ sourceSlug: 'factory', name: 'request_ticket', input: { title: 'Mic audio' }, summary: 'File the mic audio bug' })).toBe('done');
    expect(proposed).toEqual([[{ actionId: 'mcp.act', input: { sourceSlug: 'factory', tool: 'request_ticket', input: { title: 'Mic audio' }, summary: 'File the mic audio bug' }, confidence: 0.9, rationale: 'File the mic audio bug', suggestedDecision: 'approve', suggestedDecisionReason: 'File the mic audio bug' }, { tool: 'mcp_act' }]]);
    expect(await act.invoke({ sourceSlug: 'ledger', name: 'post', input: {}, summary: 's' })).toMatch(/takes no requests here/);
  });
});
