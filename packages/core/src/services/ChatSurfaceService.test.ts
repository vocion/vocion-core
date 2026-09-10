import type { ChatInbound, ChatSurfaceAdapter } from '@/libs/surfaces/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { chatChannelBindingSchema, conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const svc = await import('@/services/ChatSurfaceService');

const ORG = 'org_chat';

function fakeAdapter(): ChatSurfaceAdapter & { replies: { channelId: string; threadRef?: string; displayName?: string; iconUrl?: string; text: string }[] } {
  const replies: { channelId: string; threadRef?: string; displayName?: string; iconUrl?: string; text: string }[] = [];
  return {
    id: 'slack',
    replies,
    verify: () => ({ ok: true }),
    parse: () => ({ kind: 'ignore', reason: 'n/a' }),
    reply: async (target, text) => {
      replies.push({ ...target, text });
    },
  };
}

const inbound: ChatInbound = { surface: 'slack', teamId: 'T1', channelId: 'C1', threadRef: '100.1', messageRef: '100.1', externalUserId: 'U42', text: 'how is the quarter?', isDirect: false };

beforeEach(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(chatChannelBindingSchema);
});

describe('bindings', () => {
  it('resolves an exact channel before the team catch-all, and is org-scoped for CRUD', async () => {
    await svc.createBinding({ orgId: ORG, surface: 'slack', teamId: 'T1', channelId: '*', agentSlug: 'fallback' });
    await svc.createBinding({ orgId: ORG, surface: 'slack', teamId: 'T1', channelId: 'C1', agentSlug: 'revenue-lead' });

    expect((await svc.resolveBinding('slack', 'T1', 'C1'))?.agentSlug).toBe('revenue-lead');
    expect((await svc.resolveBinding('slack', 'T1', 'D-unknown'))?.agentSlug).toBe('fallback');
    expect(await svc.resolveBinding('slack', 'T2', 'C1')).toBeNull();
    expect((await svc.listBindings(ORG)).length).toBe(2);
    expect(await svc.listBindings('other')).toEqual([]);

    const [b] = await svc.listBindings(ORG);

    expect(await svc.deleteBinding('other', b!.id)).toBe(false);
    expect(await svc.deleteBinding(ORG, b!.id)).toBe(true);
  });
});

describe('handleJoined', () => {
  const join = { surface: 'slack', teamId: 'T1', channelId: 'C9', botUserId: 'UBOT' };

  it('introduces the binding that will answer, wearing its persona, and starts no thread', async () => {
    await svc.createBinding({ orgId: ORG, surface: 'slack', teamId: 'T1', channelId: 'C9', agentSlug: 'revenue-lead', displayName: 'Sterling Banks', iconUrl: 'https://www.vocion.ai/personas/sterling.png' });
    const adapter = fakeAdapter();
    const out = await svc.handleJoined(adapter, join);

    expect(out).toMatchObject({ outcome: 'introduced', orgId: ORG, agentSlug: 'revenue-lead' });
    expect(adapter.replies[0]).toMatchObject({ channelId: 'C9', displayName: 'Sterling Banks', iconUrl: 'https://www.vocion.ai/personas/sterling.png' });
    expect(adapter.replies[0]!.threadRef).toBeUndefined();
    expect(adapter.replies[0]!.text).toContain('Sterling Banks');
    expect(adapter.replies[0]!.text).toContain('revenue-lead');
  });

  it('falls back to the workspace catch-all for a channel nobody bound, and stays silent with no binding at all', async () => {
    const adapter = fakeAdapter();

    expect(await svc.handleJoined(adapter, join)).toEqual({ outcome: 'unbound' });
    expect(adapter.replies).toEqual([]);

    await svc.createBinding({ orgId: ORG, surface: 'slack', teamId: 'T1', channelId: '*', agentSlug: 'vocion' });

    expect(await svc.handleJoined(adapter, join)).toMatchObject({ outcome: 'introduced', agentSlug: 'vocion' });
    expect(adapter.replies[0]!.text).toContain('vocion');
    expect(Object.keys(adapter.replies[0]!)).toEqual(['channelId', 'text']);
  });
});

describe('handleInbound', () => {
  it('does nothing for an unbound channel', async () => {
    const adapter = fakeAdapter();
    const out = await svc.handleInbound(adapter, inbound, { runAgent: vi.fn(), preflight: vi.fn(async () => ({ ok: true as const })) });

    expect(out).toEqual({ outcome: 'unbound' });
    expect(adapter.replies).toEqual([]);
  });

  it('binds → runs the agent → replies in the thread, and keeps one conversation per thread', async () => {
    await svc.createBinding({ orgId: ORG, surface: 'slack', teamId: 'T1', channelId: 'C1', agentSlug: 'revenue-lead' });
    const adapter = fakeAdapter();
    const runAgent = vi.fn(async (opts: { conversationHistory?: unknown[] }) => ({ response: `history=${opts.conversationHistory?.length ?? 0}`, traceId: 't', toolCalls: [] }));
    const deps = { runAgent: runAgent as never, preflight: vi.fn(async () => ({ ok: true as const })) };

    const first = await svc.handleInbound(adapter, inbound, deps);

    expect(first.outcome).toBe('replied');
    expect(adapter.replies).toEqual([{ channelId: 'C1', threadRef: '100.1', text: 'history=0' }]);
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, agentSlug: 'revenue-lead', userId: 'slack:U42', message: 'how is the quarter?' }));

    const second = await svc.handleInbound(adapter, { ...inbound, messageRef: '100.2', text: 'and next quarter?' }, deps);

    expect(second.outcome).toBe('replied');
    expect(first.outcome === 'replied' && second.outcome === 'replied' && second.conversationId).toBe(first.outcome === 'replied' ? first.conversationId : -1);
    // user + assistant from turn 1 are the history for turn 2
    expect(adapter.replies[1]!.text).toBe('history=2');
  });

  it('replies as the binding persona when it has one, on the agent path and the budget path alike', async () => {
    await svc.createBinding({ orgId: ORG, surface: 'slack', teamId: 'T1', channelId: 'C1', agentSlug: 'revenue-lead', displayName: 'Sterling Banks', iconUrl: 'https://www.vocion.ai/personas/sterling.png' });
    const adapter = fakeAdapter();
    const persona = { displayName: 'Sterling Banks', iconUrl: 'https://www.vocion.ai/personas/sterling.png' };

    await svc.handleInbound(adapter, inbound, { runAgent: vi.fn(async () => ({ response: 'up 12%', traceId: 't', toolCalls: [] })) as never, preflight: vi.fn(async () => ({ ok: true as const })) });

    expect(adapter.replies[0]).toEqual({ channelId: 'C1', threadRef: '100.1', ...persona, text: 'up 12%' });

    await svc.handleInbound(adapter, inbound, { runAgent: vi.fn() as never, preflight: vi.fn(async () => ({ ok: false as const, reason: 'hard_cents_exceeded' as const, limit: 100, current: 150 })) });

    expect(adapter.replies[1]).toMatchObject(persona);
  });

  it('leaves the persona fields off entirely for a binding without one', async () => {
    await svc.createBinding({ orgId: ORG, surface: 'slack', teamId: 'T1', channelId: 'C1', agentSlug: 'revenue-lead' });
    const adapter = fakeAdapter();

    await svc.handleInbound(adapter, inbound, { runAgent: vi.fn(async () => ({ response: 'up 12%', traceId: 't', toolCalls: [] })) as never, preflight: vi.fn(async () => ({ ok: true as const })) });

    // toEqual, not toMatchObject: an undefined key would still reach the adapter.
    expect(adapter.replies).toEqual([{ channelId: 'C1', threadRef: '100.1', text: 'up 12%' }]);
    expect(Object.keys(adapter.replies[0]!)).toEqual(['channelId', 'threadRef', 'text']);
  });

  it('refuses over-budget agents with a short reply and never runs the agent', async () => {
    await svc.createBinding({ orgId: ORG, surface: 'slack', teamId: 'T1', channelId: 'C1', agentSlug: 'revenue-lead' });
    const adapter = fakeAdapter();
    const runAgent = vi.fn();
    const out = await svc.handleInbound(adapter, inbound, { runAgent: runAgent as never, preflight: vi.fn(async () => ({ ok: false as const, reason: 'hard_cents_exceeded' as const, limit: 100, current: 150 })) });

    expect(out).toEqual({ outcome: 'over_budget', agentSlug: 'revenue-lead' });
    expect(runAgent).not.toHaveBeenCalled();
    expect(adapter.replies[0]!.text).toMatch(/over its cents budget/);
  });

  it('turns an agent failure into a polite reply and a failed outcome', async () => {
    await svc.createBinding({ orgId: ORG, surface: 'slack', teamId: 'T1', channelId: 'C1', agentSlug: 'revenue-lead' });
    const adapter = fakeAdapter();
    const out = await svc.handleInbound(adapter, inbound, { runAgent: vi.fn(async () => {
      throw new Error('model down');
    }) as never, preflight: vi.fn(async () => ({ ok: true as const })) });

    expect(out).toMatchObject({ outcome: 'failed', error: 'model down' });
    expect(adapter.replies[0]!.text).toMatch(/Something went wrong/);
  });
});
