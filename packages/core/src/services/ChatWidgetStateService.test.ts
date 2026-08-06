import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { chatWidgetStateSchema, conversationSchema } = await import('@/models/Schema');
const { getWidgetState, setWidgetState } = await import('@/services/ChatWidgetStateService');
const { eq } = await import('drizzle-orm');

const ORG_A = 'org_widget_a';
const ORG_B = 'org_widget_b';

beforeEach(async () => {
  await db.delete(chatWidgetStateSchema);
  await db.delete(conversationSchema);
});

afterAll(async () => {
  await db.delete(chatWidgetStateSchema);
  await db.delete(conversationSchema);
});

describe('ChatWidgetStateService', () => {
  it('returns null when no state has been recorded yet', async () => {
    const state = await getWidgetState({ orgId: ORG_A, userId: 'user_1' });

    expect(state).toBeNull();
  });

  it('creates a row on first write', async () => {
    const row = await setWidgetState({ orgId: ORG_A, userId: 'user_1', agentSlug: 'gtm-orchestrator', conversationId: null });

    expect(row.agentSlug).toBe('gtm-orchestrator');
    expect(row.conversationId).toBeNull();

    const state = await getWidgetState({ orgId: ORG_A, userId: 'user_1' });

    expect(state).toMatchObject({ agentSlug: 'gtm-orchestrator', conversationId: null });
  });

  it('upserts — a second write for the same org+user updates the row instead of inserting a new one', async () => {
    await setWidgetState({ orgId: ORG_A, userId: 'user_1', agentSlug: 'gtm-orchestrator', conversationId: null });
    const [conv] = await db.insert(conversationSchema).values({ orgId: ORG_A, agentSlug: 'gtm-orchestrator', title: 'Test' }).returning();

    await setWidgetState({ orgId: ORG_A, userId: 'user_1', agentSlug: 'gtm-orchestrator', conversationId: conv!.id });

    const rows = await db.select().from(chatWidgetStateSchema).where(eq(chatWidgetStateSchema.orgId, ORG_A));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.conversationId).toBe(conv!.id);
  });

  it('scopes state by org — two orgs do not see each other\'s pointer', async () => {
    await setWidgetState({ orgId: ORG_A, userId: 'user_1', agentSlug: 'agent-a', conversationId: null });
    await setWidgetState({ orgId: ORG_B, userId: 'user_1', agentSlug: 'agent-b', conversationId: null });

    expect((await getWidgetState({ orgId: ORG_A, userId: 'user_1' }))?.agentSlug).toBe('agent-a');
    expect((await getWidgetState({ orgId: ORG_B, userId: 'user_1' }))?.agentSlug).toBe('agent-b');
  });

  it('scopes state by user — two users in the same org have independent pointers', async () => {
    await setWidgetState({ orgId: ORG_A, userId: 'user_1', agentSlug: 'agent-a', conversationId: null });
    await setWidgetState({ orgId: ORG_A, userId: 'user_2', agentSlug: 'agent-b', conversationId: null });

    expect((await getWidgetState({ orgId: ORG_A, userId: 'user_1' }))?.agentSlug).toBe('agent-a');
    expect((await getWidgetState({ orgId: ORG_A, userId: 'user_2' }))?.agentSlug).toBe('agent-b');
  });
});
