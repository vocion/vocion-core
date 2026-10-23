import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The person's own MCP servers in a turn (`followingSources.ts`): the agent is
 * assigned none, yet reads them as the person, says whose access answered,
 * and never gets a write.
 */

vi.mock('@/libs/DB');
// This workspace declares nothing: every read of the person's own server is from the turn's context.
const declared = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@/libs/outboundMcp/sources', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/outboundMcp/sources')>(),
  loadMcpSources: async () => {
    declared.loads++;
    return [];
  },
}));
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: async () => {
    throw new Error('a workspace token must never be read for the person\'s own server');
  },
}));
const signIn = vi.hoisted(() => ({ users: [] as Array<string | null | undefined>, signedIn: true }));
vi.mock('@/services/outboundMcp/personSignIn', async importOriginal => ({
  signInPath: (await importOriginal<typeof import('@/services/outboundMcp/personSignIn')>()).signInPath,
  personMcpCredentials: async ({ userId }: { userId?: string | null }) => {
    signIn.users.push(userId);
    return signIn.signedIn
      ? { ok: true, credentials: { baseUrl: 'https://knowledge.northwind.example/mcp', token: `token-${userId}` } }
      : { ok: false, why: 'not signed in', signIn: true };
  },
}));
const calls = vi.hoisted(() => ({ tools: [] as string[] }));
vi.mock('@/libs/outboundMcp/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/libs/outboundMcp/client')>();
  return {
    ...real,
    withMcp: async (_credentials: unknown, fn: (x: unknown) => unknown) => fn({}),
    // The server also offers a write; it is never declared, so it never travels.
    listMcpTools: async () => [
      { name: 'search_knowledge', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
      { name: 'delete_document', annotations: { readOnlyHint: false }, inputSchema: { type: 'object' } },
    ],
    callMcpTool: async (_client: unknown, remote: { name: string }) => {
      calls.tools.push(remote.name);
      return { content: [{ type: 'text', text: 'Northwind Expo contact · Oct 8' }] };
    },
  };
});
const { mcpTools } = await import('./mcpDirect');

const YOURS = { slug: 'company-knowledge', name: 'Company Knowledge', url: 'https://knowledge.northwind.example/mcp', readTools: ['search_knowledge'], fromOrgId: 'proj-finance', fromWorkspace: 'Finance' };
const emitted: Array<{ type: string; card?: { title: string; href?: string } }> = [];

function context(over: Partial<RuntimeContext> = {}): RuntimeContext {
  return { orgId: 'proj-revenue', userId: 'usr-alex', conversationId: 7, connectorSources: [], sourceKinds: {}, mcpSources: [], followingMcp: [YOURS], emit: (event: { type: string }) => emitted.push(event), ...over } as unknown as RuntimeContext;
}

describe('the person\'s own MCP server in a turn', () => {
  beforeEach(() => {
    Object.assign(signIn, { users: [], signedIn: true });
    calls.tools = [];
    declared.loads = 0;
    emitted.length = 0;
  });

  it('reads with the person\'s own grant although the agent is assigned no MCP source, and says whose access answered', async () => {
    const read = mcpTools(context()).find(t => t.name === 'mcp_read')!;
    const out = JSON.parse(await read.invoke({ sourceSlug: 'company-knowledge', name: 'search_knowledge', input: {} }) as string);

    expect(out.via).toBe('Company Knowledge · your connection, from Finance: read with your own sign-in, not this workspace\'s.');
    expect(out.content).toEqual([{ type: 'text', text: 'Northwind Expo contact · Oct 8' }]);
    expect(signIn.users).toEqual(['usr-alex']);
    expect(declared.loads).toBe(0);
  });

  it('never carries a write: undeclared tools are neither listed nor run', async () => {
    const tools = mcpTools(context());
    const listed = JSON.parse(await tools.find(t => t.name === 'mcp_list_tools')!.invoke({ sourceSlug: 'company-knowledge' }) as string);

    expect(listed.tools.map((t: { name: string }) => t.name)).toEqual(['search_knowledge']);

    const refused = JSON.parse(await tools.find(t => t.name === 'mcp_read')!.invoke({ sourceSlug: 'company-knowledge', name: 'delete_document', input: {} }) as string);

    expect(refused).toMatchObject({ isError: true, availableReadTools: ['search_knowledge'] });
    expect(calls.tools).toEqual([]);
  });

  it('offers the sign-in card once, from this workspace, when the person has not signed in', async () => {
    signIn.signedIn = false;
    const read = mcpTools(context()).find(t => t.name === 'mcp_read')!;

    expect(JSON.parse(await read.invoke({ sourceSlug: 'company-knowledge', name: 'search_knowledge', input: {} }) as string)).toMatchObject({ isError: true, error: expect.stringContaining('sign-in card') });

    await read.invoke({ sourceSlug: 'company-knowledge', name: 'search_knowledge', input: {} });

    expect(emitted).toHaveLength(1);

    const href = new URL(emitted[0]!.card!.href!, 'https://app.example');

    expect(Object.fromEntries(href.searchParams)).toMatchObject({ workspace: 'proj-revenue', source: 'company-knowledge' });
  });

  it('names it as the person\'s own connection in the tools, so a loose "@company kb" finds it', () => {
    const tools = mcpTools(context());

    expect(tools.find(t => t.name === 'mcp_read')!.description).toContain('company-knowledge (Company Knowledge, your connection, from Finance) reads search_knowledge');
  });

  it('gives no tools at all to a turn without them (a mission\'s)', () => {
    expect(mcpTools(context({ followingMcp: undefined }))).toEqual([]);
  });

  it('keeps one entry per endpoint when the agent already holds the server as its own', () => {
    const tools = mcpTools(context({
      connectorSources: ['knowledge'],
      sourceKinds: { knowledge: 'mcp' },
      mcpSources: [{ slug: 'knowledge', name: 'Company Knowledge', readTools: ['search_knowledge'], perPerson: true, url: 'https://knowledge.northwind.example/mcp' }],
    }));
    const description = tools.find(t => t.name === 'mcp_read')!.description;

    expect(description).toContain('knowledge (Company Knowledge, read as the person asking)');
    expect(description).not.toContain('your connection');
  });
});
