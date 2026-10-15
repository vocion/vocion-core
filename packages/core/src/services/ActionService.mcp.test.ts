import type { Principal } from '@/services/authz';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const transport = vi.hoisted(() => ({ calls: 0, fail: false }));
vi.mock('@/libs/outboundMcp/client', () => ({
  mcpCredentialsOf: () => ({ baseUrl: 'https://example.com/mcp', token: 'test' }),
  withMcp: async (_credentials: unknown, work: (client: unknown) => Promise<unknown>) => work({}),
  listMcpTools: async () => [{ name: 'post_journal', inputSchema: { type: 'object' } }],
  callMcpTool: async () => {
    transport.calls++;
    if (transport.fail) {
      throw new Error('Provider failure');
    }
    return { structuredContent: { verified: true, id: '123' } };
  },
}));
const { db } = await import('@/libs/DB');
const { actionRunSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { proposeAction, executeAction, rejectAction } = await import('@/services/ActionService');
const ORG = 'org_mcp';
const principal: Principal = { kind: 'agent', id: 'agent:finance', grants: ['mcp_call'], autonomy: 5, scope: { orgId: ORG } };
const input = { sourceSlug: 'finance', tool: 'post_journal', input: { amount: '1.00' }, summary: 'Post a test journal' };
const propose = () => proposeAction({ orgId: ORG, actionId: 'mcp.call', input, principal });

beforeEach(async () => {
  transport.calls = 0;
  transport.fail = false;
  await db.delete(actionRunSchema);
  await db.delete(knowledgeSourceSchema);
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'finance', configJson: { _connector: 'mcp', readTools: [], writeTools: ['post_journal'] } });
});

describe('MCP writes through Review', () => {
  it('queues at autonomy 5, then records the reviewer and verified provider result', async () => {
    const proposed = await propose();

    expect(proposed.status).toBe('pending');
    expect(transport.calls).toBe(0);

    const done = await executeAction(proposed.runId, ORG, { reviewedBy: 'test-human-reviewer' });

    expect(done.status).toBe('done');
    expect(transport.calls).toBe(1);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId));

    expect(row).toMatchObject({ decidedBy: 'test-human-reviewer', status: 'done', result: { result: { structuredContent: { verified: true } } } });
  });

  it('rejects without calling the provider', async () => {
    const proposed = await propose();
    await rejectAction(proposed.runId, ORG, 'No', { reviewedBy: 'test-human-reviewer' });

    expect(transport.calls).toBe(0);
  });

  it('does not resolve another tenant source', async () => {
    await expect(proposeAction({ orgId: 'other', actionId: 'mcp.call', input, principal: { ...principal, scope: { orgId: 'other' } } })).rejects.toThrow();
    expect(transport.calls).toBe(0);
  });

  it('refuses an unreviewed internal execution', async () => {
    const proposed = await propose();

    expect(await executeAction(proposed.runId, ORG)).toMatchObject({ status: 'failed', error: 'MCP writes require an explicit Review decision.' });
    expect(transport.calls).toBe(0);
  });

  it('records provider failure instead of a completed action', async () => {
    const proposed = await propose();
    transport.fail = true;

    expect(await executeAction(proposed.runId, ORG, { reviewedBy: 'test-human-reviewer' })).toMatchObject({ status: 'failed' });

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId));

    expect(row?.status).toBe('failed');
  });
});
