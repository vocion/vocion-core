/**
 * An agent's question answered on Needs you goes back to the agent, on
 * PGlite: the decision starts the hand-back job once, and the job writes the
 * typed decision event into a conversation with the agent and keeps its
 * reply. The agent's turn is a fake. Every name here is fictional.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
const started = vi.hoisted(() => [] as Array<{ id: string; call: { job: string; input: Record<string, unknown> } }>);
vi.mock('@/libs/durable/jobs', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/durable/jobs')>(),
  startJob: vi.fn(async (id: string, call: { job: string; input: Record<string, unknown> }) => {
    started.push({ id, call });
    return { id };
  }),
}));
const turns = vi.hoisted(() => [] as Array<{ agentSlug: string; message: string; userId?: string; conversationId?: number }>);
vi.mock('@/services/AgentService', () => ({
  runAgentDeep: vi.fn(async (opts: { agentSlug: string; message: string; userId?: string; conversationId?: number }) => {
    turns.push(opts);
    return { response: 'Set Dana Reyes as the author on all three posts and as the project\'s default author.', toolCalls: [], traceId: null };
  }),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, conversationMessageSchema } = await import('@/models/Schema');
const { decideAsk, upsertAsk } = await import('@/services/AskService');
const { runHandBack } = await import('./handBack');

const ORG = 'proj_handback_northwind';
const PERSON = 'usr-handback-dana';

/** The settle hook runs after the decision returns; let it finish. */
async function settled(): Promise<void> {
  for (let i = 0; i < 20 && started.length === 0; i++) {
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('an answer goes back to the agent that asked (SEO walk 2, 2026-10-27)', () => {
  beforeAll(async () => {
    await db.insert(agentSchema).values({ orgId: ORG, slug: 'seo-strategist', name: 'SEO strategist', systemPrompt: 'x' } as never);
  });

  it('starts the follow-up turn once, and the agent carries on in a conversation with the person', async () => {
    const { ask } = await upsertAsk({
      orgId: ORG,
      createdBy: 'agent:seo-strategist',
      ask: { kind: 'input', title: 'Name the author for each of the 3 sample posts', agentSlug: 'seo-strategist', teamSlug: 'seo', sourceRef: 'action_run:7001' },
    });
    await decideAsk({ orgId: ORG, id: ask.id, decision: 'other', note: 'Dana Reyes for all three, and make her the default author.', decidedBy: PERSON, via: 'needs_you' });
    await settled();

    expect(started).toHaveLength(1);
    expect(started[0]!.call).toEqual({ job: 'ask.hand-back', input: { orgId: ORG, askId: ask.id } });

    const out = await runHandBack({ orgId: ORG, askId: ask.id });

    expect(out.said).toBe(true);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.agentSlug).toBe('seo-strategist');
    expect(turns[0]!.userId).toBe(PERSON);
    expect(turns[0]!.message).toContain('Answered in their own words: Dana Reyes for all three, and make her the default author.');

    const messages = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, out.conversationId!)).orderBy(conversationMessageSchema.id);

    expect(messages.map(m => m.role)).toEqual(['decision', 'assistant']);
    expect(messages[1]!.content).toContain('default author');
  });

  it('hands back nothing for a question no agent asked', async () => {
    started.length = 0;
    const { ask } = await upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'Which day suits the review?', sourceRef: 'manual:1' } });
    await decideAsk({ orgId: ORG, id: ask.id, decision: 'other', note: 'Thursday.', decidedBy: PERSON, via: 'needs_you' });
    await new Promise(r => setTimeout(r, 50));

    expect(started).toHaveLength(0);
  });
});
