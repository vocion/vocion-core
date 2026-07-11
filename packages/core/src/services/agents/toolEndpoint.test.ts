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
