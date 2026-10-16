import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/outboundMcp/sources', () => ({ loadMcpSources: async () => [{ config: { writeTools: ['recode'] } }] }));
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: async () => ({}) }));
const remote = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/libs/outboundMcp/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/outboundMcp/client')>(),
  mcpCredentialsOf: () => ({}),
  withMcp: async (_credentials: unknown, fn: (client: unknown) => unknown) => fn({}),
  listMcpTools: async () => [{ name: 'recode', inputSchema: { type: 'object', properties: { expense_id: { type: 'string' } }, required: ['expense_id'], additionalProperties: false } }],
  callMcpTool: async () => {
    remote.calls++;
    return {};
  },
}));
const { mcpCallAction } = await import('./mcp');
const { isNeverAuto } = await import('./neverAuto');
const ctx = { orgId: 'org' };
const input = { sourceSlug: 'ledger', tool: 'recode', input: { entity_id: '6271' }, summary: 'Correct account' };

describe('MCP write proposal contract', () => {
  beforeEach(() => {
    remote.calls = 0;
  });

  it('rejects incorrect arguments before a proposal and supplies the actual schema', async () => {
    const refusal = await mcpCallAction.precheck!(ctx, input);

    expect(refusal).toContain('expense_id');
    expect(refusal).toContain('nothing was proposed or changed');
    expect(remote.calls).toBe(0);
  });

  it('accepts schema-correct proposals without executing the write', async () => {
    expect(await mcpCallAction.precheck!(ctx, { ...input, input: { expense_id: '6271' } })).toBeUndefined();
    expect(remote.calls).toBe(0);
  });

  it('cannot be released by inferred chat intent or the decision clock', async () => {
    expect(mcpCallAction.requiresReviewDecision).toBe(true);
    expect(isNeverAuto(mcpCallAction)).toBe(true);
    await expect(mcpCallAction.execute(ctx, input)).rejects.toThrow('explicit Review decision');
    expect(remote.calls).toBe(0);
  });
});
