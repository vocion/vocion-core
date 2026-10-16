import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/outboundMcp/sources', async importOriginal => ({ ...await importOriginal<typeof import('@/libs/outboundMcp/sources')>(), loadMcpSources: async () => [{ slug: 'finance', config: { readTools: ['read'], writeTools: ['write'] } }] }));
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: async () => ({ baseUrl: 'https://example.com/mcp', token: 'test' }) }));
const remote = vi.hoisted(() => ({ readOnly: true, calls: 0, sessions: 0, fail: false, transportFail: false, result: { ok: true } as Record<string, unknown> }));
vi.mock('@/libs/outboundMcp/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/outboundMcp/client')>(),
  mcpCredentialsOf: (x: unknown) => x,
  withMcp: async (_x: unknown, fn: (x: unknown) => unknown) => {
    remote.sessions++;
    if (remote.transportFail) {
      throw new Error('secret-transport-token');
    }
    return fn({});
  },
  listMcpTools: async () => [{ name: 'read', annotations: { readOnlyHint: remote.readOnly }, inputSchema: { type: 'object', properties: { start: { type: 'integer', minimum: 1 } }, additionalProperties: false } }],
  callMcpTool: async () => {
    remote.calls++;
    if (remote.fail) {
      throw new Error('secret-provider-token');
    }
    return remote.result;
  },
}));
const { mcpTools } = await import('./mcpDirect');
const { deferColdTools } = await import('../toolTiers');
const { runProposal } = await import('./proposeAction');
function context(allowed = ['finance']): RuntimeContext {
  return { orgId: 'org', connectorSources: ['finance'], sourceKinds: { finance: 'mcp' }, allowedSourceSlugs: allowed } as unknown as RuntimeContext;
}

describe('MCP source scope', () => {
  beforeEach(() => Object.assign(remote, { readOnly: true, calls: 0, sessions: 0, fail: false, transportFail: false, result: { ok: true } }));

  it('formats structured results once, preserving other content and metadata', async () => {
    const structuredContent = { records: Array.from({ length: 25 }, (_, id) => ({ id, description: 'Expense record' })) };
    const otherContent = [{ type: 'text', text: 'Provider note' }, { type: 'image', mimeType: 'image/png', data: 'image-data' }];
    remote.result = { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }, ...otherContent], isError: false };
    const read = mcpTools(context()).find(t => t.name === 'mcp_read')!;
    const result = await read.invoke({ sourceSlug: 'finance', name: 'read', input: {} }) as string;

    expect(JSON.parse(result)).toEqual({ structuredContent, content: otherContent, isError: false });
    expect(result.split('\n').length).toBeGreaterThan(100);
    expect(Math.max(...result.split('\n').map(line => line.length))).toBeLessThan(100);
    expect(result.match(/Expense record/g)).toHaveLength(25);
  });

  it('exposes no tools when the user ACL excludes the assigned source', () => {
    expect(mcpTools(context([]))).toEqual([]);
  });

  it('keeps discovery and reads visible even before either has usage history', () => {
    const tools = mcpTools(context());
    deferColdTools(tools, new Set(), tools[0]!);

    for (const tool of tools) {
      expect(tool.extras?.defer_loading).not.toBe(true);
    }
  });

  it('refuses a write through the read tool', async () => {
    const read = mcpTools(context()).find(t => t.name === 'mcp_read')!;

    expect(JSON.parse(await read.invoke({ sourceSlug: 'finance', name: 'write', input: {} }) as string)).toMatchObject({ isError: true, availableReadTools: ['read'] });
    expect(remote.sessions).toBe(0);
    expect(remote.calls).toBe(0);
  });

  it('requires provider readOnlyHint as well as the local allowlist', async () => {
    remote.readOnly = false;
    const read = mcpTools(context()).find(t => t.name === 'mcp_read')!;

    expect(JSON.parse(await read.invoke({ sourceSlug: 'finance', name: 'read', input: {} }) as string)).toMatchObject({ isError: true, error: expect.stringContaining('read-only') });
    expect(remote.calls).toBe(0);
  });

  it('refuses a proposal outside the user source ACL before creating a Review row', async () => {
    const result = await runProposal(context([]), { actionId: 'mcp.call', input: { sourceSlug: 'finance' }, confidence: 1, rationale: 'test', suggestedDecision: 'approve', suggestedDecisionReason: 'test' }, { tool: 'propose_action' });

    expect(result).toContain('outside');
  });

  it('routes a mistaken native proposal back to MCP before creating a Review row', async () => {
    const result = await runProposal(context(), { actionId: 'finance.recategorize_expense', input: { expenseId: '6271' }, confidence: 1, rationale: 'User correction', suggestedDecision: 'approve', suggestedDecisionReason: 'User correction' }, { tool: 'propose_action' });

    expect(result).toContain('mcp_list_tools');
    expect(result).toContain('propose mcp.call');
    expect(remote.calls).toBe(0);
  });

  it('omits disconnected native actions and their schemas from the catalog', async () => {
    const { actionCatalog } = await import('@/libs/actions/registry');
    const catalog = actionCatalog(context());

    expect(catalog).toContain('mcp.call');
    expect(catalog).not.toContain('finance.recategorize_expense');
    expect(catalog).not.toContain('finance.post_journal_entry');
    expect(catalog).not.toContain('finance.draft_invoice');
  });

  it('returns the schema for invalid arguments and allows a corrected next call', async () => {
    const read = mcpTools(context()).find(t => t.name === 'mcp_read')!;
    const invalid = JSON.parse(await read.invoke({ sourceSlug: 'finance', name: 'read', input: { start_position: 26 } }) as string);

    expect(invalid).toMatchObject({ isError: true, inputSchema: { properties: { start: { type: 'integer' } } } });
    expect(remote.calls).toBe(0);

    const corrected = JSON.parse(await read.invoke({ sourceSlug: 'finance', name: 'read', input: { start: 26 } }) as string);

    expect(corrected.ok).toBe(true);
    expect(remote.calls).toBe(1);
  });

  it.each(['fail', 'transportFail'] as const)('returns a sanitized read error without aborting on %s', async (failure) => {
    remote[failure] = true;
    const read = mcpTools(context()).find(t => t.name === 'mcp_read')!;
    const result = await read.invoke({ sourceSlug: 'finance', name: 'read', input: {} }) as string;

    expect(JSON.parse(result).isError).toBe(true);
    expect(result).toContain('No write tool was invoked');
    expect(result).not.toContain('secret-');
    expect(result).not.toContain('may have succeeded');
  });

  it('returns permitted names for an unknown tool and can execute a corrected read', async () => {
    const read = mcpTools(context()).find(t => t.name === 'mcp_read')!;
    const invalid = JSON.parse(await read.invoke({ sourceSlug: 'finance', name: 'mcp_list_tools', input: {} }) as string);

    expect(invalid).toMatchObject({ isError: true, availableReadTools: ['read'] });
    expect(remote.sessions).toBe(0);
    expect(remote.calls).toBe(0);
    expect(JSON.parse(await read.invoke({ sourceSlug: 'finance', name: 'read', input: {} }) as string).ok).toBe(true);
    expect(remote.calls).toBe(1);
  });

  it.each(['mcp_read', 'mcp_list_tools'])('denies an out-of-scope source without aborting %s or opening a session', async (name) => {
    const selected: StructuredToolInterface = mcpTools(context()).find(t => t.name === name)!;
    const result = await selected.invoke({ sourceSlug: 'unassigned', name: 'read', input: {} }) as string;

    expect(JSON.parse(result).isError).toBe(true);
    expect(result).not.toContain('availableReadTools');
    expect(remote.sessions).toBe(0);
    expect(remote.calls).toBe(0);
  });

  it('sanitizes discovery errors without aborting chat', async () => {
    remote.transportFail = true;
    const discovery = mcpTools(context()).find(t => t.name === 'mcp_list_tools')!;
    const result = await discovery.invoke({ sourceSlug: 'finance' }) as string;

    expect(JSON.parse(result).isError).toBe(true);
    expect(result).not.toContain('secret-');
    expect(remote.calls).toBe(0);
  });
});
