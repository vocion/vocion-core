import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/outboundMcp/sources', async importOriginal => ({ ...await importOriginal<typeof import('@/libs/outboundMcp/sources')>(), loadMcpSources: async () => [{ slug: 'finance', config: { readTools: ['read'], writeTools: ['write'] } }] }));
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: async () => ({ baseUrl: 'https://example.com/mcp', token: 'test' }) }));
const remote = vi.hoisted(() => ({ readOnly: true, calls: 0 }));
vi.mock('@/libs/outboundMcp/client', () => ({
  mcpCredentialsOf: (x: unknown) => x,
  withMcp: async (_x: unknown, fn: (x: unknown) => unknown) => fn({}),
  listMcpTools: async () => [{ name: 'read', annotations: { readOnlyHint: remote.readOnly } }],
  callMcpTool: async () => {
    remote.calls++;
    return { ok: true };
  },
}));
const { mcpTools } = await import('./mcpDirect');
const { runProposal } = await import('./proposeAction');
function context(allowed = ['finance']): RuntimeContext {
  return { orgId: 'org', connectorSources: ['finance'], sourceKinds: { finance: 'mcp' }, allowedSourceSlugs: allowed } as unknown as RuntimeContext;
}

describe('MCP source scope', () => {
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

    await expect(read.invoke({ sourceSlug: 'finance', name: 'read', input: {} })).rejects.toThrow('read-only');
    expect(remote.calls).toBe(0);
  });

  it('refuses a proposal outside the user source ACL before creating a Review row', async () => {
    const result = await runProposal(context([]), { actionId: 'mcp.call', input: { sourceSlug: 'finance' }, confidence: 1, rationale: 'test', suggestedDecision: 'approve', suggestedDecisionReason: 'test' }, { tool: 'propose_action' });

    expect(result).toContain('outside');
  });
});
