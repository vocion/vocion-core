import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/outboundMcp/sources', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/outboundMcp/sources')>(),
  loadMcpSources: async () => [{ slug: 'knowledge', name: 'Company Knowledge', config: { readTools: ['search'], writeTools: [], auth: 'person', url: 'https://knowledge.example/mcp' } }],
}));
const workspaceToken = vi.hoisted(() => ({ reads: 0 }));
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: async () => {
    workspaceToken.reads++;
    return { baseUrl: 'https://knowledge.example/mcp', token: 'workspace-token' };
  },
}));
const signIn = vi.hoisted(() => ({ users: [] as Array<string | null | undefined>, signedIn: true }));
vi.mock('@/services/outboundMcp/personSignIn', async importOriginal => ({
  signInPath: (await importOriginal<typeof import('@/services/outboundMcp/personSignIn')>()).signInPath,
  personMcpCredentials: async ({ userId }: { userId?: string | null }) => {
    signIn.users.push(userId);
    return signIn.signedIn
      ? { ok: true, credentials: { baseUrl: 'https://knowledge.example/mcp', token: `token-${userId}` } }
      : { ok: false, why: 'not signed in', signIn: true };
  },
}));
const sessions = vi.hoisted(() => ({ tokens: [] as string[] }));
vi.mock('@/libs/outboundMcp/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/outboundMcp/client')>(),
  withMcp: async (credentials: { token: string }, fn: (x: unknown) => unknown) => {
    sessions.tokens.push(credentials.token);
    return fn({});
  },
  listMcpTools: async () => [{ name: 'search', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } }],
  callMcpTool: async () => ({ content: [{ type: 'text', text: 'found' }] }),
}));
const { mcpTools } = await import('./mcpDirect');

const emitted: Array<{ type: string; card?: { title: string; href?: string } }> = [];
function context(userId?: string): RuntimeContext {
  return { orgId: 'org', userId, conversationId: 42, connectorSources: ['knowledge'], sourceKinds: { knowledge: 'mcp' }, emit: (event: { type: string }) => emitted.push(event) } as unknown as RuntimeContext;
}

describe('a per-person MCP source', () => {
  beforeEach(() => {
    Object.assign(signIn, { users: [], signedIn: true });
    Object.assign(sessions, { tokens: [] });
    workspaceToken.reads = 0;
    emitted.length = 0;
  });

  it('reads with the grant of the person in the turn, never the workspace token', async () => {
    const read = mcpTools(context('usr-alex')).find(t => t.name === 'mcp_read')!;

    expect(JSON.parse(await read.invoke({ sourceSlug: 'knowledge', name: 'search', input: {} }) as string)).toEqual({ content: [{ type: 'text', text: 'found' }] });
    expect(signIn.users).toEqual(['usr-alex']);
    expect(sessions.tokens).toEqual(['token-usr-alex']);
    expect(workspaceToken.reads).toBe(0);
  });

  it('docks one sign-in card that lands back in this conversation, calling nothing', async () => {
    signIn.signedIn = false;
    const tools = mcpTools(context('usr-cass'));

    const list = tools.find(t => t.name === 'mcp_list_tools')!;
    const read = tools.find(t => t.name === 'mcp_read')!;

    expect(JSON.parse(await list.invoke({ sourceSlug: 'knowledge' }) as string)).toMatchObject({ isError: true, error: expect.stringContaining('sign-in card') });
    expect(JSON.parse(await read.invoke({ sourceSlug: 'knowledge', name: 'search', input: {} }) as string)).toMatchObject({ isError: true, error: expect.stringContaining('sign-in card') });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.card!.title).toBe('Sign in to Company Knowledge');

    const href = new URL(emitted[0]!.card!.href!, 'https://app.example');

    expect(href.pathname).toBe('/api/connect/mcp/start');
    expect(Object.fromEntries(href.searchParams)).toMatchObject({ workspace: 'org', source: 'knowledge', returnTo: '/dashboard/chat?conversation=42', conversation: '42' });
    expect(sessions.tokens).toEqual([]);
  });
});
