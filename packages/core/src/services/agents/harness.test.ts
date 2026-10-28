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
const { agentSchema, knowledgeSourceSchema, playbookSchema, projectSchema, teamSchema, tenantAccountSchema, toolCallSchema } = await import('@/models/Schema');
const { buildChatModelForOrg } = await import('@/libs/llm');
const { buildAgentDefinition, compileAgentForRequest, initiativePromptNote, resetAgentRuntimeCache } = await import('@/services/agents/harness');

const { buildDomainTools } = await import('./tools/registry');
const { mcpTools } = await import('./tools/mcpDirect');
const { runtimeContextFromScope } = await import('./runtimeContext');

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
  await db.delete(knowledgeSourceSchema);
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
  await db.delete(playbookSchema);
  await db.delete(knowledgeSourceSchema);
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
    // (The agent's own model; the teammates' fast model is built beside it, once too.)
    expect(vi.mocked(buildChatModelForOrg).mock.calls.filter(c => c[0] === 'main')).toHaveLength(1);

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

    const calls = vi.mocked(buildChatModelForOrg).mock.calls.filter(c => c[0] === 'main');

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

describe('initiative in the system prompt', () => {
  it('appends the high note for a high-initiative agent and the low note for a low one; normal says nothing', async () => {
    await db.insert(agentSchema).values([
      { orgId: ORG, slug: 'eager', name: 'Eager', systemPrompt: 'You research.', initiative: 'high' },
      { orgId: ORG, slug: 'quiet', name: 'Quiet', systemPrompt: 'You curate.', initiative: 'low' },
    ]);

    await compile('eager');

    expect(graphOptions(0).systemPrompt).toContain('INITIATIVE: high');
    expect(graphOptions(0).systemPrompt).toContain('ONE concrete offer');

    await compile('quiet');

    expect(graphOptions(1).systemPrompt).toContain('INITIATIVE: low');
    expect(graphOptions(1).systemPrompt).not.toContain('INITIATIVE: high');

    // `revenue-lead` has no initiative column value: normal, and no note at all.
    await compile('revenue-lead');

    expect(graphOptions(2).systemPrompt).not.toContain('INITIATIVE:');
  });

  it('is the same sentence everywhere — one shape, authored once', () => {
    expect(initiativePromptNote('normal')).toBe('');
    expect(initiativePromptNote('high')).toMatch(/^INITIATIVE: high\./);
    expect(initiativePromptNote('low')).toMatch(/^INITIATIVE: low\./);
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

describe('MCP sources in the actual chat definition', () => {
  it('retains connector kinds for chat and the remote runtime while enforcing source ACLs', async () => {
    await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'ledger',
      kind: 'plugin',
      configJson: { _connector: 'mcp', readTools: ['quickbooks_list'], writeTools: [] },
    });
    await db.update(agentSchema).set({ connectorSources: ['ledger'] }).where(eq(agentSchema.slug, DIRECTOR));
    const definition = await buildAgentDefinition(ORG, DIRECTOR);
    const runtimeContext = runtimeContextFromScope(ORG, definition.agentRow, definition, { allowedSourceSlugs: ['ledger'] });

    expect(mcpTools(runtimeContext).map(tool => tool.name)).toEqual(['mcp_list_tools', 'mcp_read']);
    expect(mcpTools(runtimeContextFromScope(ORG, definition.agentRow, definition, { allowedSourceSlugs: [] }))).toEqual([]);

    vi.mocked(buildDomainTools).mockClear();
    await compile(DIRECTOR);
    const chatContext = vi.mocked(buildDomainTools).mock.calls[0]![0];

    expect(mcpTools(chatContext).map(tool => tool.name)).toEqual(['mcp_list_tools', 'mcp_read']);
  });
});

describe('teammates run with their own skills, grants and pinned model', () => {
  /** An SEO team: the strategist leads; the writer pins Opus 5.5, has its own skill and its own grant. */
  async function seoTeam(): Promise<void> {
    await db.delete(playbookSchema);
    await db.insert(playbookSchema).values({ orgId: ORG, slug: 'write-page', name: 'Writing a page', description: 'd', kind: 'skill', origin: 'core', contentSha: 'x' });
    await db.insert(agentSchema).values([
      { orgId: ORG, slug: 'seo-strategist', name: 'SEO strategist', systemPrompt: 'You lead SEO.', teamSlug: 'seo', skillSlugs: ['page-brief'] },
      { orgId: ORG, slug: 'seo-writer', name: 'SEO writer', systemPrompt: 'You write pages.', teamSlug: 'seo', skillSlugs: ['write-page'], harnessConfig: { modelProvider: 'anthropic', model: 'claude-opus-5-5', grantTools: ['serp_search'] } },
    ]);
    await db.insert(teamSchema).values({ orgId: ORG, slug: 'seo', name: 'SEO', leadAgentSlug: 'seo-strategist' });
  }

  it('mounts a teammate\'s own skills for it and adds its own grants to its tools', async () => {
    await seoTeam();
    vi.mocked(buildDomainTools).mockImplementation(ctx => (ctx.harnessConfig.grantTools ?? []).map(name => ({ name })) as never);
    await compile('seo-strategist');
    const writer = graphOptions(mockCreate.mock.calls.length - 1).subagents.find(s => s.name === 'seo-writer')!;

    expect(writer.skills).toEqual(['/teammates/seo-writer/skills/']);
    expect((writer.tools ?? []).map(t => t.name)).toContain('serp_search');
    expect(writer.model).toEqual({ stub: 'model' });

    vi.mocked(buildDomainTools).mockImplementation(() => []);
  });

  it('a pinned model that cannot be built fails loudly: the teammate is left out and the lead is told, never run on the fast model', async () => {
    await seoTeam();
    vi.mocked(buildChatModelForOrg).mockImplementation(async (_role, _org, opts) => {
      if ((opts as { model?: string } | undefined)?.model === 'claude-opus-5-5') {
        throw new Error('no Anthropic key for this workspace');
      }
      return { stub: 'model' } as never;
    });
    await compile('seo-strategist');
    const graph = graphOptions(mockCreate.mock.calls.length - 1);

    expect(graph.subagents.map(s => s.name)).not.toContain('seo-writer');
    expect(graph.systemPrompt).toContain('TEAMMATES YOU CANNOT CONSULT');
    expect(graph.systemPrompt).toContain('claude-opus-5-5 could not be started — no Anthropic key for this workspace');

    vi.mocked(buildChatModelForOrg).mockImplementation(async () => ({ stub: 'model' }) as never);
  });

  it('a teammate on its own model, as the lead delegates, sees the SEO tools in full and is told the rest can be searched', async () => {
    // The live editor run (2026-10-27): consulted in the background on its own
    // model, it got the lead's tiered tools, never searched, and said it could
    // not open the draft it was reviewing.
    const { ChatAnthropic } = await import('@langchain/anthropic');
    const { tool } = await import('@langchain/core/tools');
    const { z } = await import('zod');
    const { seoTools } = await import('./tools/seo');
    await seoTeam();
    await db.insert(agentSchema).values({ orgId: ORG, slug: 'seo-editor', name: 'SEO editor', systemPrompt: 'You check drafts.', teamSlug: 'seo', harnessConfig: { modelProvider: 'anthropic', model: 'claude-sonnet-5-5', excludeTools: ['get_brand'] } });
    // The lead's history makes the tiers: it has only ever read projects.
    await db.insert(toolCallSchema).values(Array.from({ length: 5 }, () => ({ orgId: ORG, agentSlug: 'seo-strategist', tool: 'read_project' })));
    const plain = (name: string) => tool(async () => 'ok', { name, description: `${name} does one thing.`, schema: z.object({ q: z.string().optional() }) });
    vi.mocked(buildDomainTools).mockImplementation(ctx => [plain('read_project'), plain('read_artifact'), ...seoTools(ctx)] as never);
    vi.mocked(buildChatModelForOrg).mockImplementation(async (_role, _org, opts) => new ChatAnthropic({ apiKey: 'sk-ant-test', model: (opts as { model?: string } | undefined)?.model ?? 'claude-opus-5-5' }) as never);

    await compile('seo-strategist');
    const editor = graphOptions(mockCreate.mock.calls.length - 1).subagents.find(s => s.name === 'seo-editor')!;
    const visible = (name: string) => (editor.tools ?? []).find(t => t.name === name) as { extras?: { defer_loading?: boolean } } | undefined;

    for (const name of ['seo_read_page', 'seo_save_review', 'seo_save_draft']) {
      expect(visible(name), name).toBeDefined();
      expect(visible(name)?.extras?.defer_loading, name).toBeUndefined();
    }

    // What its history never earned waits behind the search, and the teammate is told so.
    expect(visible('read_artifact')?.extras?.defer_loading).toBe(true);
    expect(editor.systemPrompt).toContain('tool_search_tool_bm25');

    await db.delete(toolCallSchema);
    vi.mocked(buildDomainTools).mockImplementation(() => []);
    vi.mocked(buildChatModelForOrg).mockImplementation(async () => ({ stub: 'model' }) as never);
  });
});
