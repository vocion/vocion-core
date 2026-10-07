/**
 * `ask_workspace` through the claim-verified tool endpoint — the path a
 * personal assistant on the agent-runtime container takes. Mirrors
 * `toolEndpoint.test.ts`: the person, the workspace and the agent come only
 * from the signed claim, and nothing in the tool's input can widen them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/AgentService')>()),
  runAgentDeep: vi.fn(async () => ({ response: 'Two renewals close this month.', traceId: 'trace-claim-1', toolCalls: [] })),
}));

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const {
  accountMembershipSchema,
  agentSchema,
  conversationMessageSchema,
  conversationSchema,
  projectMemberSchema,
  projectSchema,
  tenantAccountSchema,
  userSchema,
} = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { signClaim } = await import('./claims');
const { executeToolCall } = await import('./toolEndpoint');

const NORTHWIND = 'acct-claim-northwind';
const DANA = 'usr-claim-dana';
const EVAN = 'usr-claim-evan';
const REVENUE = 'proj-claim-revenue';

let danaHome: string;

beforeEach(async () => {
  process.env.VOCION_TOOL_SIGNING_SECRET = 'test-secret-for-assistant-claims';
  process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
  vi.mocked(runAgentDeep).mockClear();
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(agentSchema);
  await db.delete(projectMemberSchema);
  await db.delete(projectSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(userSchema);
  await db.delete(tenantAccountSchema);

  await db.insert(tenantAccountSchema).values({ id: NORTHWIND, name: 'Northwind', slug: 'northwind-claim' });
  await db.insert(userSchema).values([
    { id: DANA, email: 'dana@northwind.example', name: 'Dana Whitfield' },
    { id: EVAN, email: 'evan@northwind.example', name: 'Evan Marsh' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: NORTHWIND, userId: DANA, role: 'member' },
    { accountId: NORTHWIND, userId: EVAN, role: 'member' },
  ]);
  await db.insert(projectSchema).values({ id: REVENUE, accountId: NORTHWIND, slug: 'revenue', name: 'Revenue Team', leadAgentSlug: 'revenue-lead' });
  await db.insert(projectMemberSchema).values({ projectId: REVENUE, userId: DANA, role: 'member' });
  await db.insert(agentSchema).values({ orgId: REVENUE, projectId: REVENUE, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'You lead revenue.', role: 'lead', active: 'true' });
  danaHome = (await ensurePersonalProject(DANA, NORTHWIND)).id;
});

describe('ask_workspace over the tool endpoint', () => {
  it('acts as the person the claim names, in the workspace asked', async () => {
    const token = signClaim({ orgId: danaHome, agentSlug: 'assistant', userId: DANA });
    const result = await executeToolCall({ token, tool: 'ask_workspace', input: { workspace: 'revenue', message: 'What closes this month?' } });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.output).toContain('Two renewals close this month.');
      // The steps travel back with the output, for the artifact to re-emit.
      expect(result.events.some(e => e.type === 'trace_node' && e.kind === 'delegate')).toBe(true);
    }

    expect(vi.mocked(runAgentDeep).mock.calls[0]![0]).toMatchObject({ orgId: REVENUE, userId: DANA, agentSlug: 'revenue-lead' });

    const [child] = await db.select().from(conversationSchema).where(eq(conversationSchema.orgId, REVENUE));

    expect(child).toMatchObject({ createdBy: DANA, surface: 'assistant' });
  });

  it('a claim for someone else in this personal workspace reaches nothing', async () => {
    const token = signClaim({ orgId: danaHome, agentSlug: 'assistant', userId: EVAN });
    const result = await executeToolCall({ token, tool: 'ask_workspace', input: { workspace: 'revenue', message: 'What closes this month?' } });

    expect(result).toMatchObject({ ok: true });

    if (result.ok) {
      expect(result.output).toContain('is one you can reach from here');
    }

    expect(runAgentDeep).not.toHaveBeenCalled();
    expect(await db.select().from(conversationSchema)).toEqual([]);
  });

  it('nothing in the input widens the claim: a userId or orgId in the body is ignored', async () => {
    const token = signClaim({ orgId: danaHome, agentSlug: 'assistant', userId: EVAN });
    const result = await executeToolCall({ token, tool: 'ask_workspace', input: { workspace: 'revenue', message: 'x', userId: DANA, orgId: REVENUE } });

    if (result.ok) {
      expect(result.output).toContain('is one you can reach from here');
    }

    expect(runAgentDeep).not.toHaveBeenCalled();
  });

  it('an agent in a shared workspace has no such tool', async () => {
    const token = signClaim({ orgId: REVENUE, agentSlug: 'revenue-lead', userId: DANA });
    const result = await executeToolCall({ token, tool: 'ask_workspace', input: { workspace: 'revenue', message: 'x' } });

    expect(result).toEqual({ ok: false, status: 404, error: 'unknown tool: ask_workspace' });
  });

  it('a claim naming the assistant under another workspace is refused before any tool runs', async () => {
    const token = signClaim({ orgId: REVENUE, agentSlug: 'assistant', userId: DANA });
    const result = await executeToolCall({ token, tool: 'ask_workspace', input: { workspace: 'revenue', message: 'x' } });

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(runAgentDeep).not.toHaveBeenCalled();
  });
});
