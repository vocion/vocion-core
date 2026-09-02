/**
 * Tool-call activity record — the row per invocation, its attribution,
 * its failure isolation, and its tenant scoping.
 */
import type { RuntimeContext } from './types';
import { tool } from '@langchain/core/tools';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { toolCallSchema } = await import('@/models/Schema');
const { persistToolCall, withToolCallRecord } = await import('./toolCallRecord');

const ORG_A = 'org_toolcall_a';
const ORG_B = 'org_toolcall_b';

function ctxFor(orgId: string, extra: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    orgId,
    agentSlug: 'revenue-lead',
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
    conversationId: 42,
    provider: 'local',
    delegations: new Map(),
    ...extra,
  };
}

beforeEach(async () => {
  await db.delete(toolCallSchema);
});

afterAll(async () => {
  await db.delete(toolCallSchema);
});

describe('withToolCallRecord', () => {
  it('writes one row per invocation with the turn context', async () => {
    const echo = withToolCallRecord(
      tool(async (input: { q: string }) => `echo:${input.q}`, {
        name: 'echo',
        schema: z.object({ q: z.string() }),
      }),
      ctxFor(ORG_A),
    );

    const out = await echo.invoke({ q: 'hello' });

    expect(out).toBe('echo:hello');

    // The write is fire-and-forget; give it a beat.
    await vi.waitFor(async () => {
      const rows = await db.select().from(toolCallSchema).where(eq(toolCallSchema.orgId, ORG_A));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.tool).toBe('echo');
      expect(rows[0]!.agentSlug).toBe('revenue-lead');
      expect(rows[0]!.input).toEqual({ q: 'hello' });
      expect(rows[0]!.output).toBe('echo:hello');
      expect(rows[0]!.error).toBeNull();
      expect(rows[0]!.conversationId).toBe(42);
      expect(rows[0]!.provider).toBe('local');
    });
  });

  it('records the error and rethrows when the tool fails', async () => {
    const boom = withToolCallRecord(
      tool(async () => {
        throw new Error('kaput');
      }, { name: 'boom', schema: z.object({}) }),
      ctxFor(ORG_A),
    );

    await expect(boom.invoke({})).rejects.toThrow('kaput');

    await vi.waitFor(async () => {
      const rows = await db.select().from(toolCallSchema).where(eq(toolCallSchema.orgId, ORG_A));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.error).toBe('kaput');
    });
  });

  it('attributes a delegated call to the specialist, keeping the lead as dispatcher', async () => {
    const ctx = ctxFor(ORG_A);
    ctx.delegations!.set('task_abc', 'qa-analyst');
    const t = withToolCallRecord(
      tool(async () => 'ok', { name: 'lookup_objects', schema: z.object({}) }),
      ctx,
    );

    await t.invoke({}, { metadata: { checkpoint_ns: 'tools:task_abc|tools:sub_1' } } as never);

    await vi.waitFor(async () => {
      const rows = await db.select().from(toolCallSchema).where(eq(toolCallSchema.orgId, ORG_A));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.agentSlug).toBe('qa-analyst');
      expect(rows[0]!.leadAgentSlug).toBe('revenue-lead');
    });
  });

  it('a lead-level call carries no lead_agent_slug', async () => {
    const t = withToolCallRecord(
      tool(async () => 'ok', { name: 'web_search', schema: z.object({}) }),
      ctxFor(ORG_A),
    );

    await t.invoke({}, { metadata: { checkpoint_ns: 'tools:call_1' } } as never);

    await vi.waitFor(async () => {
      const rows = await db.select().from(toolCallSchema).where(eq(toolCallSchema.orgId, ORG_A));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.agentSlug).toBe('revenue-lead');
      expect(rows[0]!.leadAgentSlug).toBeNull();
    });
  });
});

describe('tenant scoping', () => {
  it('rows are org-scoped: one org never reads the other org\'s calls', async () => {
    await persistToolCall({ ctx: ctxFor(ORG_A), tool: 'search_knowledge', input: { query: 'a' }, output: 'x', durationMs: 5, ns: '' });
    await persistToolCall({ ctx: ctxFor(ORG_B), tool: 'search_knowledge', input: { query: 'b' }, output: 'y', durationMs: 5, ns: '' });

    const { activityFeed } = await import('@/services/ActivityService');
    const feedA = await activityFeed(ORG_A, { kind: 'tool' });
    const feedB = await activityFeed(ORG_B, { kind: 'tool' });

    expect(feedA).toHaveLength(1);
    expect(feedB).toHaveLength(1);
    expect(feedA[0]!.detail).toContain('"query":"a"');
    expect(feedB[0]!.detail).toContain('"query":"b"');
  });
});

describe('failure isolation', () => {
  it('a failed row write never fails the tool call', async () => {
    // A ctx whose orgId is null-ish would break the insert; the wrapper
    // must swallow the write failure and still return the tool result.
    const ctx = ctxFor(ORG_A);
    (ctx as { orgId: unknown }).orgId = null;
    const t = withToolCallRecord(
      tool(async () => 'still fine', { name: 'echo', schema: z.object({}) }),
      ctx,
    );

    await expect(t.invoke({})).resolves.toBe('still fine');
  });
});
