/**
 * Two turns on one agent must not be able to see each other (issue #109).
 *
 * The harness used to cache the compiled graph, whose tools had closed over
 * a single RuntimeContext that every request then overwrote in place. Two
 * overlapping turns on the same `(org, agent)` therefore traded identities:
 * one person's events went to the other's stream, one person's retrieval ran
 * under the other's source permissions, and `tool_call` rows were stamped
 * with whichever person happened to bind last. A background
 * `refresh_briefing` run overlapping the turn that started it was enough to
 * trigger it, so the overlap is routine rather than exotic.
 *
 * These tests compile two requests on one agent — the second while the first
 * is still "running", exactly as two concurrent turns do — and then ask what
 * the first turn's tools would read at call time. Every assertion below
 * failed before the fix.
 *
 * No live model and no real graph: deepagents' createDeepAgent is mocked to
 * capture its options, and the tool registry is mocked down to one fake tool
 * that carries the context it was built with.
 */
import type { AgentEvent, RuntimeContext } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/llm', () => ({
  buildChatModel: vi.fn(() => ({ stub: 'model' })),
  buildChatModelForOrg: vi.fn(async () => ({ stub: 'model' })),
}));
vi.mock('@/services/agents/tools/registry', () => ({
  // One fake tool that keeps the context it was built with, so a test can ask
  // what this compiled graph's tools would see when the model calls them.
  buildDomainTools: vi.fn((ctx: RuntimeContext) => [{ name: 'report_context', ctx }] as never),
}));
vi.mock('deepagents', () => ({
  createDeepAgent: vi.fn((opts: unknown) => ({ compiled: true, opts })),
  StateBackend: class {},
  StoreBackend: class {},
  CompositeBackend: class {},
  filesValue: {},
}));

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { compileAgentForRequest, resetAgentRuntimeCache } = await import('@/services/agents/harness');

const ORG = 'proj_concurrent_turns';
const AGENT = 'revenue-lead';

type FakeTool = { name: string; ctx: RuntimeContext };
type CompiledForTest = Awaited<ReturnType<typeof compileAgentForRequest>>;

/**
 * The context this compiled graph's own tools would read at call time —
 * what the tools closed over, not what the harness returned.
 * @param compiled - A graph from `compileAgentForRequest`.
 */
function toolContext(compiled: CompiledForTest): RuntimeContext {
  const { opts } = compiled.graph as unknown as { opts: { tools: FakeTool[] } };
  return opts.tools[0]!.ctx;
}

/**
 * The context a DELEGATE of this compiled graph would read — a specialist
 * must answer under the person who asked, never under anyone else.
 * @param compiled - A graph from `compileAgentForRequest`.
 */
function delegateContext(compiled: CompiledForTest): RuntimeContext {
  const { opts } = compiled.graph as unknown as { opts: { subagents: Array<{ tools: FakeTool[] }> } };
  return opts.subagents[0]!.tools[0]!.ctx;
}

beforeEach(async () => {
  resetAgentRuntimeCache();
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);

  await db.insert(tenantAccountSchema).values({ id: 'acct-concurrent', name: 'MetaCTO', slug: 'metacto' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-concurrent', slug: 'revenue', name: 'Revenue' });
  await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'Revenue Lead', systemPrompt: 'You lead RevOps.' });
});

describe('two concurrent turns on one agent', () => {
  it('gives each turn tools that carry its OWN person, sources and conversation', async () => {
    const chris = await compileAgentForRequest(ORG, AGENT, {
      emit: () => {},
      userId: 'usr-chris',
      allowedSourceSlugs: ['gmail', 'drive'],
      conversationId: 11,
    });
    // Jamie's turn starts while Chris's is still running — and may read less.
    const jamie = await compileAgentForRequest(ORG, AGENT, {
      emit: () => {},
      userId: 'usr-jamie',
      allowedSourceSlugs: ['drive'],
      conversationId: 22,
    });

    // Chris's retrieval still runs as Chris, over Chris's sources. Sharing one
    // context let Jamie's narrower ACL widen to Chris's — or Chris's reach
    // leak into Jamie's turn, which is the source-access-control bypass.
    expect(toolContext(chris).userId).toBe('usr-chris');
    expect(toolContext(chris).allowedSourceSlugs).toEqual(['gmail', 'drive']);
    expect(toolContext(chris).conversationId).toBe(11);

    expect(toolContext(jamie).userId).toBe('usr-jamie');
    expect(toolContext(jamie).allowedSourceSlugs).toEqual(['drive']);
    expect(toolContext(jamie).conversationId).toBe(22);
  });

  it('delivers a turn\'s events only to that turn\'s stream', async () => {
    const toChris: AgentEvent[] = [];
    const toJamie: AgentEvent[] = [];

    const chris = await compileAgentForRequest(ORG, AGENT, { emit: e => toChris.push(e), userId: 'usr-chris' });
    await compileAgentForRequest(ORG, AGENT, { emit: e => toJamie.push(e), userId: 'usr-jamie' });

    // A tool on Chris's turn emits after Jamie's turn has started.
    toolContext(chris).emit({ type: 'thinking' });

    expect(toChris).toHaveLength(1);
    expect(toJamie).toHaveLength(0);
  });

  it('keeps citation numbering and delegation attribution inside one turn', async () => {
    const chris = await compileAgentForRequest(ORG, AGENT, { emit: () => {}, userId: 'usr-chris' });
    const jamie = await compileAgentForRequest(ORG, AGENT, { emit: () => {}, userId: 'usr-jamie' });

    // Chris's turn hands out [1]–[3] and delegates once.
    toolContext(chris).citationSeq.current += 3;
    toolContext(chris).delegations!.set('task-1', 'pipeline-analyst');

    // Jamie's turn starts its own numbering at zero, so the `[n]` markers the
    // model cites are the sources Jamie's own searches returned.
    expect(toolContext(jamie).citationSeq.current).toBe(0);
    expect(toolContext(jamie).delegations!.size).toBe(0);
  });

  it('runs a delegate on the asking person\'s context, never a neighbour\'s', async () => {
    const chris = await compileAgentForRequest(ORG, AGENT, {
      emit: () => {},
      userId: 'usr-chris',
      allowedSourceSlugs: ['gmail', 'drive'],
    });
    await compileAgentForRequest(ORG, AGENT, { emit: () => {}, userId: 'usr-jamie', allowedSourceSlugs: ['drive'] });

    expect(delegateContext(chris)).toBe(toolContext(chris));
    expect(delegateContext(chris).userId).toBe('usr-chris');
    expect(delegateContext(chris).allowedSourceSlugs).toEqual(['gmail', 'drive']);
  });

  it('gives a mission or schedule run its own context too, with no user attached', async () => {
    const person = await compileAgentForRequest(ORG, AGENT, {
      emit: () => {},
      userId: 'usr-chris',
      allowedSourceSlugs: ['gmail'],
      conversationId: 11,
    });
    // The fire-and-forget briefing refresh: no person, no conversation, and it
    // overlaps the turn that started it (tools/briefing.ts).
    const background = await compileAgentForRequest(ORG, AGENT, { emit: () => {}, missionSlug: 'daily-brief', missionRunId: 7 });

    expect(toolContext(background).userId).toBeUndefined();
    expect(toolContext(background).allowedSourceSlugs).toBeUndefined();
    expect(toolContext(background).missionRunId).toBe(7);

    // And the foreground turn is untouched by it.
    expect(toolContext(person).userId).toBe('usr-chris');
    expect(toolContext(person).allowedSourceSlugs).toEqual(['gmail']);
    expect(toolContext(person).missionSlug).toBeUndefined();
    expect(toolContext(person).conversationId).toBe(11);
  });
});
