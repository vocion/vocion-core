/**
 * End-to-end suite for the agent-tools bridge: the domain tool registry
 * served over MCP, ctx rebuilt from real agent rows, source/grant gates
 * re-applied per call, and the propose_action review-queue invariant pinned
 * (external writes must land PENDING, never execute, regardless of who holds
 * the MCP credential).
 */
import type { McpConfig } from '../config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { buildServer } = await import('../server');

const ORG = 'test_org_bridge';

const scratchDir = mkdtempSync(join(tmpdir(), 'cc-mcp-bridge-'));

function configFor(agentSlug?: string): McpConfig {
  return {
    orgId: ORG,
    contextPath: scratchDir,
    diskWorkspace: true,
    autoCommit: false,
    autoApply: false,
    serverName: 'vocion-test',
    serverVersion: '0.0.0',
    agentSlug,
  };
}

async function setupClientServer(config: McpConfig) {
  const server = await buildServer(config, { userId: 'token:test' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

type ToolResult = { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

function resultText(result: ToolResult): string {
  return result.content?.find(c => c.type === 'text')?.text ?? '';
}

async function listToolNames(client: Client): Promise<string[]> {
  const listed = await client.listTools();
  return listed.tools.map(t => t.name);
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(agentSchema).values([
    {
      orgId: ORG,
      slug: 'lead-agent',
      name: 'Lead',
      systemPrompt: 'You lead.',
      skillSlugs: [],
      connectorSources: ['gmail'],
      objectTypeSlugs: [],
      harnessConfig: {},
    },
    {
      orgId: ORG,
      slug: 'crm-agent',
      name: 'CRM',
      systemPrompt: 'You read CRM.',
      skillSlugs: [],
      connectorSources: ['hubspot', 'hubspot-contacts'],
      objectTypeSlugs: [],
      harnessConfig: {},
    },
    {
      orgId: ORG,
      slug: 'prospecting-agent',
      name: 'Prospecting',
      systemPrompt: 'You prospect.',
      skillSlugs: [],
      connectorSources: ['apollo'],
      objectTypeSlugs: [],
      // One list write granted, one not: the second gate is per tool.
      harnessConfig: { grantTools: ['apollo_add_to_list'] },
    },
    {
      orgId: ORG,
      slug: 'product-agent',
      name: 'Product',
      systemPrompt: 'You rank requests.',
      skillSlugs: [],
      connectorSources: [],
      // Works with one object type: the write tool is present, and scoped to it.
      objectTypeSlugs: ['request'],
      harnessConfig: {},
    },
  ]);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  rmSync(scratchDir, { recursive: true, force: true });
});

describe('agent-tools bridge — tool surface', () => {
  it('serves the domain tools for the configured default agent', async () => {
    const { client, server } = await setupClientServer(configFor('lead-agent'));
    try {
      const names = await listToolNames(client);

      // Bridged domain tools present.
      expect(names).toContain('search_knowledge');
      expect(names).toContain('lookup_objects');
      expect(names).toContain('freshen_source');
      expect(names).toContain('propose_action');
      // A question for a person, and its withdrawal, are on for every agent.
      expect(names).toContain('file_ask');
      expect(names).toContain('withdraw_ask');
      // The record write is present only for an agent with object types.
      expect(names).not.toContain('update_object');
      // Source-gated: lead-agent has gmail, not hubspot/zoom/apollo.
      expect(names).toContain('get_gmail_thread');
      expect(names).not.toContain('hubspot_count_deals');
      expect(names).not.toContain('get_zoom_transcript');
      expect(names).not.toContain('apollo_search_people');
      expect(names).not.toContain('apollo_enrich');
      // Emit-only / mission-bound tools stay off the MCP surface.
      expect(names).not.toContain('request_human_review');
      expect(names).not.toContain('recommend_action');
      expect(names).not.toContain('update_mission_notes');
      // Capability duplicates are served once (by capability-tools).
      expect(names.filter(n => n === 'web_search')).toHaveLength(1);
      expect(names.filter(n => n === 'run_code')).toHaveLength(1);
      // The base MCP surface is intact alongside the bridge.
      expect(names).toContain('search_query');
    } finally {
      await server.close();
    }
  });

  it('serves only the base surface when the org has no resolvable agent', async () => {
    const { client, server } = await setupClientServer(configFor(undefined));
    try {
      const names = await listToolNames(client);

      expect(names).toContain('search_query');
      expect(names).not.toContain('search_knowledge');
    } finally {
      await server.close();
    }
  });

  it('falls back to the workspace lead (project.leadAgentSlug)', async () => {
    await db.insert(tenantAccountSchema).values({ id: 'acct_bridge', name: 'Bridge', slug: 'bridge' });
    await db.insert(projectSchema).values({
      id: ORG,
      accountId: 'acct_bridge',
      slug: 'bridge',
      name: 'Bridge',
      leadAgentSlug: 'crm-agent',
    });
    const { client, server } = await setupClientServer(configFor(undefined));
    try {
      const names = await listToolNames(client);

      // crm-agent's sources gate the surface: hubspot in, gmail out.
      expect(names).toContain('hubspot_count_deals');
      expect(names).not.toContain('get_gmail_thread');
    } finally {
      await server.close();
    }
  });
});

describe('agent-tools bridge — the object write', () => {
  it('serves update_object to an agent with object types, scoped to them', async () => {
    const { client, server } = await setupClientServer(configFor('product-agent'));
    try {
      const names = await listToolNames(client);

      expect(names).toContain('update_object');

      // A type outside the agent's list is refused by the tool itself, before
      // anything reaches the rail — the MCP credential never widens it.
      const result = (await client.callTool({
        name: 'update_object',
        arguments: { object_type: 'product', id: 1, set: { promises: [] }, reason: 'test', confidence: 0.9 },
      })) as ToolResult;

      // A refusal is a plain sentence, JSON-encoded by the server like any
      // other string result; no events, because nothing was proposed.
      expect(JSON.parse(resultText(result))).toMatch(/does not work with "product" records\. It may write: request/);
      expect(await db.select().from(actionRunSchema)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});

describe('agent-tools bridge — the Apollo surface', () => {
  it('serves every Apollo read to an agent with the source, and only the granted write', async () => {
    const { client, server } = await setupClientServer(configFor('prospecting-agent'));
    try {
      const names = await listToolNames(client);

      // The twelve-tool surface, minus the write this agent was not granted.
      expect(names).toContain('apollo_search_people');
      expect(names).toContain('apollo_enrich');
      expect(names).toContain('apollo_bulk_enrich');
      expect(names).toContain('apollo_search_companies');
      expect(names).toContain('apollo_enrich_company');
      expect(names).toContain('apollo_list_labels');
      expect(names).toContain('apollo_list_contacts');
      expect(names).toContain('apollo_usage');
      // Granted.
      expect(names).toContain('apollo_add_to_list');
      // Not granted: a list write can indirectly start outreach.
      expect(names).not.toContain('apollo_remove_from_list');
      // This agent has no hubspot source, so routing never has to guess.
      expect(names).not.toContain('hubspot_count_deals');
    } finally {
      await server.close();
    }
  });

  it('keeps Apollo away from an agent whose sources do not include it', async () => {
    const { client, server } = await setupClientServer(configFor('crm-agent'));
    try {
      const names = await listToolNames(client);

      expect(names.filter(name => name.startsWith('apollo_'))).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

describe('agent-tools bridge — calls', () => {
  it('returns parsed JSON (not double-encoded) from a registry tool', async () => {
    const { client, server } = await setupClientServer(configFor('crm-agent'));
    try {
      const result = (await client.callTool({
        name: 'hubspot_count_deals',
        arguments: {},
      })) as ToolResult;

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(resultText(result));

      // Double-encoding would make this a string, not an object.
      expect(typeof parsed).toBe('object');
      expect(parsed.total).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('re-gates per call: agent_slug switches to that agent\'s sources', async () => {
    const { client, server } = await setupClientServer(configFor('crm-agent'));
    try {
      // Default agent (crm-agent) reaches the tool…
      const ok = (await client.callTool({ name: 'hubspot_count_deals', arguments: {} })) as ToolResult;

      expect(ok.isError).toBeFalsy();

      // …but running as lead-agent (no hubspot source) is refused.
      const refused = (await client.callTool({
        name: 'hubspot_count_deals',
        arguments: { agent_slug: 'lead-agent' },
      })) as ToolResult;

      expect(refused.isError).toBe(true);
      expect(resultText(refused)).toMatch(/not available for agent "lead-agent"/);
    } finally {
      await server.close();
    }
  });

  it('errors on an unknown agent_slug', async () => {
    const { client, server } = await setupClientServer(configFor('lead-agent'));
    try {
      const result = (await client.callTool({
        name: 'search_knowledge',
        arguments: { query: 'anything', agent_slug: 'ghost' },
      })) as ToolResult;

      expect(result.isError).toBe(true);
      expect(resultText(result)).toMatch(/agent "ghost" not found/);
    } finally {
      await server.close();
    }
  });

  it('propose_action refuses a proposal that recommends nothing', async () => {
    // Enforced by the schema rather than asked for in the description: a card
    // with no recommendation cannot be compared against what the reviewer
    // decided, and that comparison is the only read anyone has on whether the
    // agent's criteria are working.
    const { client, server } = await setupClientServer(configFor('lead-agent'));
    try {
      const result = (await client.callTool({
        name: 'propose_action',
        arguments: {
          action_id: 'gmail.send',
          action_input: { to: 'client@example.com', subject: 'Hi', body: 'Draft body' },
          confidence: 0.9,
          rationale: 'Test proposal.',
        },
      })) as ToolResult;

      expect(result.isError).toBe(true);
      expect(resultText(result)).toMatch(/suggested_decision/);
    } finally {
      await server.close();
    }
  });

  it('propose_action lands PENDING in the review queue — never executes', async () => {
    const { client, server } = await setupClientServer(configFor('lead-agent'));
    try {
      const result = (await client.callTool({
        name: 'propose_action',
        arguments: {
          action_id: 'gmail.send',
          action_input: { to: 'client@example.com', subject: 'Hi', body: 'Draft body' },
          confidence: 0.9,
          rationale: 'Test proposal.',
          suggested_decision: 'approve',
          suggested_decision_reason: 'The client asked for this draft on the Sep 14 call.',
        },
      })) as ToolResult;

      expect(result.isError).toBeFalsy();

      // The emit buffer surfaces alongside the output.
      const parsed = JSON.parse(resultText(result)) as { output: string; events: unknown[] };

      expect(parsed.output).toMatch(/PENDING human approval/);
      expect(parsed.events.length).toBeGreaterThan(0);

      const runs = await db.select().from(actionRunSchema);

      expect(runs).toHaveLength(1);
      expect(runs[0]!.status).toBe('pending');
      expect(runs[0]!.orgId).toBe(ORG);
      // Proposed by the agent principal — the MCP credential never widens it.
      expect(runs[0]!.invokedBy).toBe('agent:lead-agent');
    } finally {
      await server.close();
    }
  });
});
