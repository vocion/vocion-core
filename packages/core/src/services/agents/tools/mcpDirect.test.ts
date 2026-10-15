import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/outboundMcp/sources', async importOriginal => ({ ...await importOriginal<typeof import('@/libs/outboundMcp/sources')>(), loadMcpSources: async () => [{ slug: 'finance', config: { readTools: ['read'], writeTools: ['write'] } }] }));
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: async () => ({ baseUrl: 'https://example.com/mcp', token: 'test' }) }));
const remote = vi.hoisted(() => ({ readOnly: true, calls: 0, fail: false, transportFail: false }));
vi.mock('@/libs/outboundMcp/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/outboundMcp/client')>(),
  mcpCredentialsOf: (x: unknown) => x,
  withMcp: async (_x: unknown, fn: (x: unknown) => unknown) => {
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
    return { ok: true };
  },
}));
const { mcpTools } = await import('./mcpDirect');
const { runProposal } = await import('./proposeAction');
function context(allowed = ['finance']): RuntimeContext {
  return { orgId: 'org', connectorSources: ['finance'], sourceKinds: { finance: 'mcp' }, allowedSourceSlugs: allowed } as unknown as RuntimeContext;
}

describe('MCP source scope', () => {
  beforeEach(() => Object.assign(remote, { readOnly: true, calls: 0, fail: false, transportFail: false }));

  it('exposes no tools when the user ACL excludes the assigned source', () => {
    expect(mcpTools(context([]))).toEqual([]);
  });

  it('refuses a write through the read tool', async () => {
    const read = mcpTools(context()).find(t => t.name === 'mcp_read')!;

    await expect(read.invoke({ sourceSlug: 'finance', name: 'write', input: {} })).rejects.toThrow('Only explicitly declared reads');
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
});
