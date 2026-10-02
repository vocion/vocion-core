/**
 * Cross-tenant refusal suite for the claim-verified tool endpoint —
 * the Phase 1 exit criterion of the BYOA migration: every tool call is
 * scoped exactly to the tenant core signed, and nothing the caller
 * sends in the body can widen that scope.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { signClaim } = await import('./claims');
const { executeToolCall } = await import('./toolEndpoint');

const ORG_A = 'org_tools_a';
const ORG_B = 'org_tools_b';

beforeEach(async () => {
  process.env.VOCION_TOOL_SIGNING_SECRET = 'test-secret-for-tool-endpoint';
  await db.delete(agentSchema);
  await db.insert(agentSchema).values([
    {
      orgId: ORG_A,
      slug: 'helper',
      name: 'Helper A',
      systemPrompt: 'You help org A.',
      skillSlugs: [],
      connectorSources: [],
      objectTypeSlugs: [],
      harnessConfig: { provider: 'runtime' },
    },
    {
      orgId: ORG_B,
      slug: 'other',
      name: 'Other B',
      systemPrompt: 'You help org B.',
      skillSlugs: [],
      connectorSources: [],
      objectTypeSlugs: [],
      harnessConfig: { provider: 'runtime', excludeTools: ['propose_action'] },
    },
    {
      orgId: ORG_A,
      slug: 'prospector',
      name: 'Prospector A',
      systemPrompt: 'You prospect for org A.',
      skillSlugs: [],
      connectorSources: ['apollo'],
      objectTypeSlugs: [],
      harnessConfig: { provider: 'runtime' },
    },
  ]);
});

afterAll(async () => {
  await db.delete(agentSchema);
});

describe('executeToolCall — claim enforcement', () => {
  it('refuses a missing/garbage token', async () => {
    const result = await executeToolCall({ token: 'garbage', tool: 'list_learning_steps', input: {} });

    expect(result).toEqual({ ok: false, status: 401, error: 'invalid claim: malformed' });
  });

  it('refuses an expired claim', async () => {
    const token = signClaim({ orgId: ORG_A, agentSlug: 'helper', exp: Date.now() - 1 });
    const result = await executeToolCall({ token, tool: 'list_learning_steps', input: {} });

    expect(result).toEqual({ ok: false, status: 401, error: 'invalid claim: expired' });
  });

  it('refuses a claim whose agent does not exist in the claimed org', async () => {
    // `other` exists only in org B — a claim naming it under org A must refuse.
    const token = signClaim({ orgId: ORG_A, agentSlug: 'other' });
    const result = await executeToolCall({ token, tool: 'list_learning_steps', input: {} });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });

  it('refuses tools the agent excludes via harness config', async () => {
    const token = signClaim({ orgId: ORG_B, agentSlug: 'other' });
    const result = await executeToolCall({ token, tool: 'propose_action', input: {} });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('refuses unknown tools', async () => {
    const token = signClaim({ orgId: ORG_A, agentSlug: 'helper' });
    const result = await executeToolCall({ token, tool: 'drop_all_tables', input: {} });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('executes a tool under a valid claim, scoped to the claimed org', async () => {
    const token = signClaim({ orgId: ORG_A, agentSlug: 'helper' });
    const result = await executeToolCall({ token, tool: 'list_learning_steps', input: {} });

    expect(result.ok).toBe(true);

    if (result.ok) {
      // Org A has no learning steps — the tool answers (proving org-scoped
      // execution) rather than refusing.
      expect(typeof result.output).toBe('string');
      expect(Array.isArray(result.events)).toBe(true);
    }
  });
});

describe('source-gated tools over the endpoint', () => {
  it('refuses an Apollo tool to an agent whose sources do not include apollo', async () => {
    const token = signClaim({ orgId: ORG_A, agentSlug: 'helper' });

    const result = await executeToolCall({ token, tool: 'apollo_search_people', input: {} });

    expect(result.ok).toBe(false);
  });

  it('refuses a list write the agent was not granted, even with the source', async () => {
    const token = signClaim({ orgId: ORG_A, agentSlug: 'prospector' });

    const result = await executeToolCall({ token, tool: 'apollo_add_to_list', input: { list_name: 'x', contact: { email: 'a@b.com' } } });

    expect(result.ok).toBe(false);
  });

  it('refuses an Apollo tool under a claim for an org whose agent slug is another org\'s', async () => {
    // The claim names org B; `prospector` exists only in org A, so the agent
    // does not resolve and nothing in the body can widen the scope.
    const token = signClaim({ orgId: ORG_B, agentSlug: 'prospector' });

    const result = await executeToolCall({ token, tool: 'apollo_search_people', input: {} });

    expect(result.ok).toBe(false);
  });
});

/**
 * What a turn on the container carries back on each tool call.
 *
 * The in-process harness builds its tools on a context that knows the mission
 * run, the person's zone, the page they are on and which plugins the workspace
 * has on. This endpoint rebuilds that context per call, from the claim and the
 * database, and it used to rebuild less of it: a mission run's calls landed on
 * no run, and the wiki tools (built only when the `wiki` plugin is listed)
 * did not exist at all for an agent on the container.
 */
describe('executeToolCall — the context a container turn gets back', () => {
  it('hands the tool the page the claim was signed with', async () => {
    const pageContext = { path: '/dashboard/p/feature/40', title: 'Feature 40' };
    const token = signClaim({ orgId: ORG_A, agentSlug: 'helper', pageContext });

    const result = await executeToolCall({ token, tool: 'page_context', input: {} });

    expect(result.ok).toBe(true);
    expect(JSON.parse((result as { output: string }).output)).toMatchObject({ present: true, path: '/dashboard/p/feature/40' });
  });

  it('records the call against the mission run the claim names', async () => {
    const { toolCallSchema } = await import('@/models/Schema');
    await db.delete(toolCallSchema);
    const token = signClaim({ orgId: ORG_A, agentSlug: 'helper', missionRunId: 4242 });

    await executeToolCall({ token, tool: 'page_context', input: {} });

    await vi.waitFor(async () => {
      const rows = await db.select().from(toolCallSchema);

      expect(rows.map(r => r.missionRunId)).toEqual([4242]);
    });
  });

  it('offers the wiki when the workspace has the wiki plugin on', async () => {
    const PluginService = await import('@/services/PluginService');
    const spy = vi.spyOn(PluginService, 'enabledPluginsForOrg').mockResolvedValue(['wiki']);
    const token = signClaim({ orgId: ORG_A, agentSlug: 'helper' });

    const result = await executeToolCall({ token, tool: 'list_wiki_pages', input: {} });

    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(ORG_A);

    spy.mockRestore();
  });

  it('still has no wiki when the plugin is off', async () => {
    const PluginService = await import('@/services/PluginService');
    const spy = vi.spyOn(PluginService, 'enabledPluginsForOrg').mockResolvedValue([]);
    const token = signClaim({ orgId: ORG_A, agentSlug: 'helper' });

    const result = await executeToolCall({ token, tool: 'list_wiki_pages', input: {} });

    expect(result).toEqual({ ok: false, status: 404, error: 'unknown tool: list_wiki_pages' });

    spy.mockRestore();
  });
});
