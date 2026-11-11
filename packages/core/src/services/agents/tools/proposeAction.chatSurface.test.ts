import type { AgentEvent, RuntimeContext } from '../types';
/**
 * WHERE THEY READ DECIDES WHAT IS TRUE, ON A REAL THREAD (2026-11-11). The wording for a thread
 * was proven against a hand-made turn while a real one still heard "docked above their composer":
 * the thread's conversation carried no surface, so it read as the app's. Here the turn is the one
 * `ChatSurfaceService.handleInbound` starts, and where the conversation is read comes off its row.
 */
import type { ChatInbound, ChatSurfaceAdapter } from '@/libs/surfaces/types';
import type { runAgentDeep } from '@/services/AgentService';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('../turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('../turnJudge')>();
  return { ...real, saidToDecide: vi.fn(async () => ({ said: false, quote: null })) };
});
vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: vi.fn(async () => ({ runId: 77, status: 'pending', outcome: 'created' })),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, chatChannelBindingSchema, conversationMessageSchema, conversationSchema, slackPostSchema } = await import('@/models/Schema');
const svc = await import('@/services/ChatSurfaceService');
const { createConversation } = await import('@/services/ConversationService');
const { runProposal } = await import('./proposeAction');

const ORG = 'org_thread_wording';

const filing = {
  actionId: 'objects.propose_candidate',
  input: { objectType: 'repo', title: 'northwind/send-api', fields: { url: 'https://github.example/northwind/send-api' }, dedupOn: ['slug'] },
  confidence: 0.85,
  rationale: 'The person named this repository.',
  suggestedDecision: 'approve' as const,
  suggestedDecisionReason: 'They asked for it.',
};

const inbound: ChatInbound = { surface: 'slack', teamId: 'T1', channelId: 'C1', threadRef: '100.1', messageRef: '100.1', externalUserId: 'U42', text: 'include send-api', isDirect: false };

const adapter: ChatSurfaceAdapter = {
  id: 'slack',
  verify: () => ({ ok: true }),
  parse: () => ({ kind: 'ignore', reason: 'n/a' }),
  reply: async target => ({ channelId: target.channelId, ts: '900.1', media: 'none' as const }),
};

/**
 * The agent, standing in for the loop: it proposes once, on the turn exactly as the surface started it.
 * @param heard
 */
function proposingAgent(heard: string[]) {
  return vi.fn(async (opts: Parameters<typeof runAgentDeep>[0]) => {
    const ctx = { orgId: opts.orgId, userId: opts.userId, agentSlug: opts.agentSlug, conversationId: opts.conversationId, connectorSources: [], objectTypeSlugs: ['repo'], turnMessage: opts.message, emit: (_e: AgentEvent) => {} } as unknown as RuntimeContext;
    heard.push(await runProposal(ctx, filing, { tool: 'file_repo' }));
    return { response: 'Reply yes and I will add northwind/send-api.', traceId: 't', toolCalls: [] };
  });
}

beforeEach(async () => {
  await db.delete(slackPostSchema);
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(chatChannelBindingSchema);
  await db.delete(agentSchema);
  await svc.createBinding({ orgId: ORG, surface: 'slack', teamId: 'T1', channelId: 'C1', agentSlug: 'product-manager' });
});

describe('a proposal that waits on a person, filed from a turn a chat surface started', () => {
  it('tells the agent the truth for a thread: nothing is in front of them, so the ask is its own line', async () => {
    const heard: string[] = [];
    await svc.handleInbound(adapter, inbound, { runAgent: proposingAgent(heard) as never, preflight: vi.fn(async () => ({ ok: true as const })), approval: vi.fn(async () => null) });

    expect(heard).toHaveLength(1);
    expect(heard[0]).not.toContain('docked above their composer');
    expect(heard[0]).toContain('no card or button is in front of them');
    expect(heard[0]).toContain('Their reply in this thread that approves it runs it');
  });

  it('says the same in a thread whose conversation began before its surface was recorded', async () => {
    // As production had it: the row a thread made carried the default surface, the app's.
    const legacy = await createConversation({ orgId: ORG, agentSlug: 'product-manager', createdBy: 'slack:U42', scopeRef: 'slack:C1:100.1' });

    expect(legacy!.surface).toBe('app');

    const heard: string[] = [];
    const out = await svc.handleInbound(adapter, inbound, { runAgent: proposingAgent(heard) as never, preflight: vi.fn(async () => ({ ok: true as const })), approval: vi.fn(async () => null) });

    expect(out).toMatchObject({ outcome: 'replied', conversationId: legacy!.id });
    expect((await db.select().from(conversationSchema).where(eq(conversationSchema.id, legacy!.id)))[0]!.surface).toBe('slack');
    expect(heard[0]).not.toContain('docked above their composer');
    expect(heard[0]).toContain('no card or button is in front of them');
  });

  it('still says a decision is docked in a conversation read in the app', async () => {
    const appConv = await createConversation({ orgId: ORG, agentSlug: 'product-manager', createdBy: 'usr-jamie' });
    const ctx = { orgId: ORG, userId: 'usr-jamie', agentSlug: 'product-manager', conversationId: appConv!.id, connectorSources: [], objectTypeSlugs: ['repo'], turnMessage: 'include send-api', emit: (_e: AgentEvent) => {} } as unknown as RuntimeContext;

    expect(await runProposal(ctx, filing, { tool: 'file_repo' })).toContain('docked above their composer');
  });
});
