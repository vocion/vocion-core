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
vi.mock('@/services/outboundMcp/personSignIn', () => ({
  personMcpCredentials: async ({ userId }: { userId?: string | null }) => {
    signIn.users.push(userId);
    return signIn.signedIn
      ? { ok: true, credentials: { baseUrl: 'https://knowledge.example/mcp', token: `token-${userId}` } }
      : { ok: false, why: 'Sign in to Company Knowledge: [Sign in](https://app.example/api/connect/mcp/start?workspace=org&source=knowledge)' };
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

function context(userId?: string): RuntimeContext {
  return { orgId: 'org', userId, connectorSources: ['knowledge'], sourceKinds: { knowledge: 'mcp' } } as unknown as RuntimeContext;
}

describe('a per-person MCP source', () => {
  beforeEach(() => {
    Object.assign(signIn, { users: [], signedIn: true });
    Object.assign(sessions, { tokens: [] });
    workspaceToken.reads = 0;
  });

  it('reads with the grant of the person in the turn, never the workspace token', async () => {
    const read = mcpTools(context('usr-alex')).find(t => t.name === 'mcp_read')!;

    expect(JSON.parse(await read.invoke({ sourceSlug: 'knowledge', name: 'search', input: {} }) as string)).toEqual({ content: [{ type: 'text', text: 'found' }] });
    expect(signIn.users).toEqual(['usr-alex']);
    expect(sessions.tokens).toEqual(['token-usr-alex']);
    expect(workspaceToken.reads).toBe(0);
  });

  it('answers with the sign-in link when the person has not signed in, calling nothing', async () => {
    signIn.signedIn = false;
    const tools = mcpTools(context('usr-cass'));

    const list = tools.find(t => t.name === 'mcp_list_tools')!;
    const read = tools.find(t => t.name === 'mcp_read')!;

    expect(JSON.parse(await list.invoke({ sourceSlug: 'knowledge' }) as string)).toMatchObject({ isError: true, error: expect.stringContaining('/api/connect/mcp/start?') });
    expect(JSON.parse(await read.invoke({ sourceSlug: 'knowledge', name: 'search', input: {} }) as string)).toMatchObject({ isError: true, error: expect.stringContaining('/api/connect/mcp/start?') });
    expect(sessions.tokens).toEqual([]);
  });
});
