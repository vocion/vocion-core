/**
 * F1 "consult the leads" — CHAT path. The harness compiles an agent's
 * dispatchable subagents from the `agent.subagents` JSONB column
 * (harness.ts buildGraph); slice 2 merges the TEAM LEADS from the
 * `team` table into that set when the compiled agent is the workspace
 * lead (project.lead_agent_slug), so "how's the quarter?" in chat can
 * consult every team with per-team provenance (acceptance #4), and
 * lead-less teams are named in the system prompt so the answer degrades
 * per team — "no lead yet" — instead of silently omitting one
 * (acceptance #5).
 *
 * No live model call and no real graph: deepagents' createDeepAgent is
 * mocked to capture its options; the DB is the PGlite test mock (same
 * pattern as missions/team-dispatch.test.ts).
 */
import type { SubAgent } from 'deepagents';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/llm', () => ({
  buildChatModel: vi.fn(() => ({ stub: 'model' })),
  // The harness resolves the org's own provider key before building the model.
  buildChatModelForOrg: vi.fn(async () => ({ stub: 'model' })),
}));
vi.mock('@/services/agents/tools/registry', () => ({ buildDomainTools: vi.fn(() => []) }));
vi.mock('deepagents', () => ({
  createDeepAgent: vi.fn((opts: unknown) => ({ compiled: true, opts })),
  StateBackend: class {},
  StoreBackend: class {},
  CompositeBackend: class {},
  filesValue: {},
}));

const { createDeepAgent } = await import('deepagents');
const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, teamSchema, tenantAccountSchema } = await import('@/models/Schema');
const { buildChatModelForOrg } = await import('@/libs/llm');
const { compileAgentForRequest, resetAgentRuntimeCache } = await import('@/services/agents/harness');

const mockCreate = vi.mocked(createDeepAgent);

const ORG = 'proj_f1_chat';
const DIRECTOR = 'revenue-director';

type GraphOptions = { subagents: SubAgent[]; systemPrompt?: string; model?: unknown };

/**
 * Compile the agent the way a chat turn does. The request fields these
 * tests don't care about stay empty — what matters here is the graph the
 * harness hands the model.
 * @param slug - The agent to compile.
 */
async function compile(slug: string) {
  return compileAgentForRequest(ORG, slug, { emit: () => {} });
}

/**
 * The options buildGraph handed to createDeepAgent on its Nth call.
 * @param n
 */
function graphOptions(n = 0): GraphOptions {
  return mockCreate.mock.calls[n]![0] as unknown as GraphOptions;
}

beforeEach(async () => {
  resetAgentRuntimeCache();
  mockCreate.mockClear();
  vi.mocked(buildChatModelForOrg).mockClear();
  await db.delete(teamSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);

  await db.insert(tenantAccountSchema).values({ id: 'acct-chat', name: 'MetaCTO', slug: 'metacto' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-chat', slug: 'revenue', name: 'Revenue', leadAgentSlug: DIRECTOR });
  await db.insert(agentSchema).values([
    {
      orgId: ORG,
      slug: DIRECTOR,
      name: 'Revenue Director',
      systemPrompt: 'You run the whole revenue workspace.',
      // An AUTHORED subagent colliding with a team-lead slug — JSONB wins.
      subagents: [{ name: 'marketing-lead', description: 'Authored marketing subagent', systemPrompt: 'authored prompt' }],
    },
    { orgId: ORG, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'You lead RevOps.', teamSlug: 'revenue-ops' },
    { orgId: ORG, slug: 'marketing-lead', name: 'Marketing Lead', systemPrompt: 'You lead Marketing.', teamSlug: 'marketing' },
  ]);
  await db.insert(teamSchema).values([
    { orgId: ORG, slug: 'revenue-ops', name: 'RevOps', description: 'Pipeline and follow-ups.', leadAgentSlug: 'revenue-lead' },
    { orgId: ORG, slug: 'marketing', name: 'Marketing', leadAgentSlug: 'marketing-lead' },
    { orgId: ORG, slug: 'founder-gtm', name: 'Founder GTM', leadAgentSlug: null },
  ]);
});

afterAll(async () => {
  resetAgentRuntimeCache();
  await db.delete(teamSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('workspace-lead chat graph (F1 slice 2)', () => {
  it('merges the team leads into the lead\'s subagents, with the team named for provenance', async () => {
    await compile(DIRECTOR);

    const { subagents } = graphOptions();
    const names = subagents.map(s => s.name);

    // The authored JSONB subagent survives AND wins its name collision
    // with the marketing team's lead — the team-table entry is skipped.
    // A `general-purpose` subagent carrying the never-dump discipline is
    // injected last on every agent (harness.ts) so delegate work synthesizes.
    expect(names).toEqual(['marketing-lead', 'revenue-lead', 'general-purpose']);
    expect(subagents[0]).toMatchObject({ description: 'Authored marketing subagent', systemPrompt: 'authored prompt' });

    // The merged team lead carries its TEAM in the description (the
    // per-team provenance the chat trace shows) and runs on the lead
    // agent's own authored prompt.
    expect(subagents[1]!.description).toContain('lead of the RevOps team');
    expect(subagents[1]!.description).toContain('Pipeline and follow-ups.');
    expect(subagents[1]!.systemPrompt).toBe('You lead RevOps.');
  });

  it('names lead-less teams in the system prompt — degrade per team, never omit (acceptance #5)', async () => {
    await compile(DIRECTOR);

    const { systemPrompt } = graphOptions();

    expect(systemPrompt).toContain('You run the whole revenue workspace.');
    expect(systemPrompt).toContain('Founder GTM');
    expect(systemPrompt).toContain('no lead yet');
  });

  it('leaves every non-workspace-lead agent untouched', async () => {
    await compile('revenue-lead');

    const { subagents, systemPrompt } = graphOptions();

    // No team merge for a non-workspace-lead — only the injected discipline subagent.
    expect(subagents.map(s => s.name)).toEqual(['general-purpose']);
    // The authored prompt leads; the shared OUTPUT_DISCIPLINE is appended.
    expect(systemPrompt).toContain('You lead RevOps.');
  });

  it('compiles from JSONB alone when no workspace lead is configured', async () => {
    await db.update(projectSchema).set({ leadAgentSlug: null });
    await compile(DIRECTOR);

    const { subagents, systemPrompt } = graphOptions();

    expect(subagents.map(s => s.name)).toEqual(['marketing-lead', 'general-purpose']);
    expect(systemPrompt).toContain('You run the whole revenue workspace.');
  });

  it('reuses the cached blueprint across requests but never the graph (issue #109)', async () => {
    const first = await compile(DIRECTOR);
    const again = await compile(DIRECTOR);

    // The agent's request-independent parts are built once: the same row and
    // the same model object serve both requests, and the model was resolved
    // from the org's credentials only once.
    expect(again.agentRow).toBe(first.agentRow);
    expect(graphOptions(1).model).toBe(graphOptions(0).model);
    expect(vi.mocked(buildChatModelForOrg)).toHaveBeenCalledTimes(1);

    // The graph and the context its tools close over are NOT shared: a second
    // turn must not be able to see or overwrite the first turn's identity.
    expect(again.graph).not.toBe(first.graph);
    expect(again.ctx).not.toBe(first.ctx);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('never caches a model override — the next ordinary turn runs the agent\'s own model', async () => {
    // The model-upgrade test runs one turn on a candidate model. If that
    // blueprint were cached, the next person to chat with this agent would be
    // answered by the candidate instead of the agent's own model.
    await compileAgentForRequest(ORG, DIRECTOR, { emit: () => {} }, { modelOverride: { model: 'claude-candidate-x', provider: 'anthropic' } });
    await compile(DIRECTOR);

    const calls = vi.mocked(buildChatModelForOrg).mock.calls;

    expect(calls).toHaveLength(2);
    expect(calls[0]![2]).toMatchObject({ model: 'claude-candidate-x', provider: 'anthropic' });
    expect(calls[1]![2]).not.toHaveProperty('model');
  });

  it('rebuilds the blueprint after resetAgentRuntimeCache (the post-apply flush)', async () => {
    await compile(DIRECTOR);

    // workspace:apply flushes the cache (applier.ts) so a team change —
    // here Founder GTM gaining a lead — reaches the next chat turn.
    await db.insert(agentSchema).values({ orgId: ORG, slug: 'gtm-lead', name: 'GTM Lead', systemPrompt: 'You lead Founder GTM.' });
    await db.update(teamSchema).set({ leadAgentSlug: 'gtm-lead' }).where(eq(teamSchema.slug, 'founder-gtm'));
    resetAgentRuntimeCache();

    await compile(DIRECTOR);

    const names = graphOptions(1).subagents.map(s => s.name);

    expect(names).toContain('gtm-lead');
    expect(graphOptions(1).systemPrompt).not.toContain('no lead yet');
  });
});

describe('buildGraph org scoping', () => {
  it('compiles the requested ORG\'s agent, never a same-slug row from another org', async () => {
    // The prod incident: two projects (plus orphaned rows from older deploys)
    // can hold the same agent slug. An unscoped slug lookup picked an
    // arbitrary row, so one org's chat compiled another org's prompt/config —
    // and freshly granted tools never reached the model.
    await db.insert(projectSchema).values({ id: 'proj_other', accountId: 'acct-chat', slug: 'other', name: 'Other' });
    await db.insert(agentSchema).values([
      { orgId: ORG, slug: 'shared-lead', name: 'Ours', systemPrompt: 'You are the CURRENT org agent.', harnessConfig: { grantTools: ['classify_call'] } },
      { orgId: 'proj_other', slug: 'shared-lead', name: 'Theirs', systemPrompt: 'You are the OTHER org agent.', harnessConfig: {} },
    ]);

    const compiled = await compile('shared-lead');

    expect(compiled.agentRow.orgId).toBe(ORG);
    expect(compiled.agentRow.harnessConfig).toEqual({ grantTools: ['classify_call'] });
    expect(graphOptions(mockCreate.mock.calls.length - 1).systemPrompt).toContain('CURRENT org agent');
  });
});
