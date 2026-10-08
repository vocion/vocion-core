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
const { accessEventSchema, toolCallSchema } = await import('@/models/Schema');
const { persistToolCall, withToolCallRecord } = await import('./toolCallRecord');
const { flushAccessLog, noteRead, resetAccessLogForTests } = await import('@/services/access/accessLog');
const { declareReads } = await import('./toolReads');

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

  it('hands a call that misses the schema back as a message the model can fix, instead of ending the turn', async () => {
    const read = withToolCallRecord(
      tool(async ({ id }: { id: number }) => `record ${id}`, { name: 'read_object', schema: z.object({ id: z.number(), object_type: z.string() }) }),
      ctxFor(ORG_A),
    );

    const asText = await read.invoke({ object_type: 'request' } as never);

    expect(String(asText)).toMatch(/^Not recorded: invalid arguments for read_object: [\s\S]*Nothing ran\. Fix the arguments and call read_object again\.$/);

    const asMessage = await read.invoke({ type: 'tool_call', id: 'call_1', name: 'read_object', args: { object_type: 'request' } } as never) as { content: string; tool_call_id: string };

    expect(asMessage.tool_call_id).toBe('call_1');
    expect(asMessage.content).toMatch(/^Not recorded: invalid arguments for read_object/);

    // The tool's own work failing still throws (see 'records the error and rethrows').
    expect(await read.invoke({ id: 7, object_type: 'request' })).toBe('record 7');

    // The rows land asynchronously; let them, so the next test starts clean.
    await vi.waitFor(async () => {
      expect(await db.select().from(toolCallSchema).where(eq(toolCallSchema.orgId, ORG_A))).toHaveLength(3);
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

describe('the access log — every tool reads as its agent, on its run', () => {
  async function reads(orgId: string) {
    await flushAccessLog();
    return db.select().from(accessEventSchema).where(eq(accessEventSchema.orgId, orgId));
  }

  beforeEach(async () => {
    resetAccessLogForTests();
    await db.delete(accessEventSchema);
  });

  it('a tool says what it read; the wrapper says who, for whom, on which run and through which tool', async () => {
    const t = withToolCallRecord(
      tool(async (input: { id: number }) => {
        noteRead({ action: 'view', record: { kind: 'object', id: input.id } });
        return 'the record';
      }, { name: 'read_object', schema: z.object({ id: z.number() }) }),
      ctxFor(ORG_A, { userId: 'usr-dana' }),
    );

    await expect(t.invoke({ id: 12 })).resolves.toBe('the record');

    const [row, ...rest] = await reads(ORG_A);

    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      actorKind: 'agent',
      actorId: 'revenue-lead',
      onBehalfOf: 'usr-dana',
      runKind: 'conversation',
      runId: '42',
      action: 'view',
      recordKind: 'object',
      recordId: '12',
      via: 'tool:read_object',
    });
  });

  it('a delegated read is the specialist\'s, and a mission\'s read is on its mission run', async () => {
    const ctx = ctxFor(ORG_A, { missionRunId: 5974, userId: 'scheduled' });
    ctx.delegations!.set('task_abc', 'qa-analyst');
    const t = withToolCallRecord(
      tool(async () => {
        noteRead({ action: 'search', record: { kind: 'document' }, detail: { hits: 3 } });
        return 'hits';
      }, { name: 'search_knowledge', schema: z.object({}) }),
      ctx,
    );

    await t.invoke({}, { metadata: { checkpoint_ns: 'tools:task_abc|tools:sub_1' } } as never);

    expect((await reads(ORG_A))[0]).toMatchObject({ actorId: 'qa-analyst', onBehalfOf: 'scheduled', runKind: 'mission_run', runId: '5974', detail: { hits: 3 } });
  });

  it('a declared read is written for the tool: one view of the record its arguments name', async () => {
    const t = withToolCallRecord(
      declareReads(tool(async () => 'the company', { name: 'hubspot_get_company', schema: z.object({ company_id: z.string() }) }), { kind: 'hubspot_company', idArg: 'company_id' }),
      ctxFor(ORG_A, { userId: 'usr-dana' }),
    );
    await t.invoke({ company_id: '8812' });

    expect(await reads(ORG_A)).toEqual([expect.objectContaining({
      actorKind: 'agent',
      actorId: 'revenue-lead',
      onBehalfOf: 'usr-dana',
      action: 'view',
      recordKind: 'hubspot_company',
      recordId: '8812',
      via: 'tool:hubspot_get_company',
    })]);
  });

  it('a declaration with no id argument is a search, and several id arguments name one thing together', async () => {
    const search = withToolCallRecord(
      declareReads(tool(async () => 'issues', { name: 'tracker_search_issues', schema: z.object({ query: z.string() }) }), { kind: 'tracker_issue' }),
      ctxFor(ORG_A),
    );
    const pull = withToolCallRecord(
      declareReads(tool(async () => 'the pull', { name: 'repo_read_pull', schema: z.object({ url: z.string().optional(), number: z.number().optional() }) }), { kind: 'pull_request', idArg: ['url', 'number'] }),
      ctxFor(ORG_A),
    );
    await search.invoke({ query: 'checkout' });
    await pull.invoke({ url: 'northwind/api', number: 12 });

    expect((await reads(ORG_A)).map(r => [r.action, r.recordKind, r.recordId]).sort()).toEqual([
      ['search', 'tracker_issue', null],
      ['view', 'pull_request', 'northwind/api:12'],
    ]);
  });

  it('a tool that notes its own read is not written twice, and one that declares \'noted\' and finds nothing writes nothing', async () => {
    const t = withToolCallRecord(
      declareReads(tool(async (input: { id: number }) => {
        if (input.id > 0) {
          noteRead({ action: 'view', record: { kind: 'document', id: input.id } });
          return 'found';
        }
        return 'no such document';
      }, { name: 'get_zoom_transcript', schema: z.object({ id: z.number() }) }), 'noted'),
      ctxFor(ORG_A),
    );
    await t.invoke({ id: 77 });
    await t.invoke({ id: 0 });

    expect((await reads(ORG_A)).map(r => [r.recordKind, r.recordId])).toEqual([['document', '77']]);
  });

  it('a declared read that throws writes no row: nothing was handed over', async () => {
    const t = withToolCallRecord(
      declareReads(tool(async () => {
        throw new Error('HubSpot said 500');
      }, { name: 'hubspot_get_company', schema: z.object({ company_id: z.string() }) }), { kind: 'hubspot_company', idArg: 'company_id' }),
      ctxFor(ORG_A),
    );

    await expect(t.invoke({ company_id: '8812' })).rejects.toThrow('HubSpot said 500');

    expect(await reads(ORG_A)).toHaveLength(0);
  });

  it('a tool that reads no record writes nothing, and the scope ends with the call', async () => {
    const t = withToolCallRecord(tool(async () => 'ok', { name: 'web_search', schema: z.object({}) }), ctxFor(ORG_A));
    await t.invoke({});

    expect(await reads(ORG_A)).toHaveLength(0);
    // After the call, nobody is in scope.
    expect(noteRead({ action: 'view', record: { kind: 'object', id: 1 } })).toBe(false);
  });
});
