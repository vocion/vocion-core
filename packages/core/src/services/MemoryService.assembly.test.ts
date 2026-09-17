/**
 * The layer stack — Phase 2's acceptance surface. Worth pinning: a user-scoped
 * preference mounts only for that user's turns, an agent-scoped procedure only
 * for that agent, object knowledge resolves per object and never leaks across
 * objects or orgs (the cross-tenant pattern from toolEndpoint.test.ts), and
 * the budget keeps entries by layer precedence, then occurrences, then recency.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));
vi.mock('@/services/adoption/attribution', () => ({ agentSlugFromPrincipal: vi.fn(() => undefined) }));

const { db } = await import('@/libs/DB');
const { memoryNamespaceSchema, memorySchema } = await import('@/models/Schema');
const {
  addRule,
  assembleAgentMemory,
  ensureScopedNamespace,
  objectKnowledge,
} = await import('@/services/MemoryService');

const ORG = 'org_layers';
const OTHER_ORG = 'org_layers_other';

beforeEach(async () => {
  await db.delete(memorySchema);
  await db.delete(memoryNamespaceSchema);
  await db.insert(memoryNamespaceSchema).values([
    { orgId: ORG, name: 'global', path: 'workspace/global', title: 'Global', description: 'Workspace-wide rules' },
  ]);
  await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Never invent numbers.' });
});

describe('assembleAgentMemory — layer isolation', () => {
  it('mounts a user preference only for that user turns', async () => {
    const jamie = await ensureScopedNamespace(ORG, 'user', 'user_jamie');
    await addRule({ orgId: ORG, stepName: jamie.name, ruleText: 'Jamie prefers no em dashes.', type: 'preference' });

    const jamieTurn = await assembleAgentMemory(ORG, { agentSlug: 'revenue-lead', workspaceSteps: ['global'], userId: 'user_jamie' });
    const chrisTurn = await assembleAgentMemory(ORG, { agentSlug: 'revenue-lead', workspaceSteps: ['global'], userId: 'user_chris' });
    const systemTurn = await assembleAgentMemory(ORG, { agentSlug: 'revenue-lead', workspaceSteps: ['global'] });

    expect(Object.values(jamieTurn).join('\n')).toContain('Jamie prefers no em dashes.');
    expect(Object.values(chrisTurn).join('\n')).not.toContain('Jamie prefers no em dashes.');
    expect(Object.values(systemTurn).join('\n')).not.toContain('Jamie prefers no em dashes.');
    // The workspace layer mounts for everyone.
    expect(Object.values(chrisTurn).join('\n')).toContain('Never invent numbers.');
  });

  it('mounts an agent procedure only for that agent', async () => {
    const ns = await ensureScopedNamespace(ORG, 'agent', 'revenue-lead');
    await addRule({ orgId: ORG, stepName: ns.name, ruleText: 'Cite the contact brief in every output.', type: 'procedure' });

    const lead = await assembleAgentMemory(ORG, { agentSlug: 'revenue-lead', workspaceSteps: ['global'] });
    const analyst = await assembleAgentMemory(ORG, { agentSlug: 'pipeline-analyst', workspaceSteps: ['global'] });

    expect(Object.values(lead).join('\n')).toContain('Cite the contact brief');
    expect(Object.values(analyst).join('\n')).not.toContain('Cite the contact brief');
  });

  it('mounts mission context only when the mission is in play', async () => {
    const ns = await ensureScopedNamespace(ORG, 'mission', 'adoption');
    await addRule({ orgId: ORG, stepName: ns.name, ruleText: 'This objective emphasizes agency growth.', type: 'knowledge' });

    const onMission = await assembleAgentMemory(ORG, { agentSlug: 'revenue-lead', workspaceSteps: [], missionSlug: 'adoption' });
    const chat = await assembleAgentMemory(ORG, { agentSlug: 'revenue-lead', workspaceSteps: [] });

    expect(Object.values(onMission).join('\n')).toContain('agency growth');
    expect(Object.values(chat).join('\n')).not.toContain('agency growth');
  });

  it('never crosses orgs, whatever the refs say', async () => {
    const ns = await ensureScopedNamespace(ORG, 'user', 'user_jamie');
    await addRule({ orgId: ORG, stepName: ns.name, ruleText: 'Jamie prefers no em dashes.', type: 'preference' });

    const otherOrgTurn = await assembleAgentMemory(OTHER_ORG, { agentSlug: 'revenue-lead', workspaceSteps: ['global'], userId: 'user_jamie' });

    expect(Object.values(otherOrgTurn).join('\n')).toBe('');
  });
});

describe('assembleAgentMemory — budget', () => {
  it('keeps higher layers and better-evidenced rules when over budget', async () => {
    const agentNs = await ensureScopedNamespace(ORG, 'agent', 'revenue-lead');
    // A workspace rule big enough to squeeze the budget (24k chars).
    await addRule({ orgId: ORG, stepName: 'global', ruleText: `IMPORTANT-WORKSPACE ${'x'.repeat(22_000)}`, occurrenceCount: 5 });
    await addRule({ orgId: ORG, stepName: agentNs.name, ruleText: `AGENT-WELL-EVIDENCED ${'y'.repeat(1_000)}`, occurrenceCount: 9 });
    await addRule({ orgId: ORG, stepName: agentNs.name, ruleText: `AGENT-BULKY-ONCE-ASKED ${'z'.repeat(3_000)}`, occurrenceCount: 1 });

    const files = await assembleAgentMemory(ORG, { agentSlug: 'revenue-lead', workspaceSteps: ['global'] });
    const mounted = Object.values(files).join('\n');

    // Workspace layer wins first, then the agent rule with more evidence; the
    // bulky once-asked rule is what ages out.
    expect(mounted).toContain('IMPORTANT-WORKSPACE');
    expect(mounted).toContain('AGENT-WELL-EVIDENCED');
    expect(mounted).not.toContain('AGENT-BULKY-ONCE-ASKED');
  });
});

describe('objectKnowledge — the entities-in-play layer', () => {
  it('resolves facts per object and never leaks across objects or orgs', async () => {
    const northwind = await ensureScopedNamespace(ORG, 'object', 'account/41');
    const gauge = await ensureScopedNamespace(ORG, 'object', 'account/77');
    await addRule({ orgId: ORG, stepName: northwind.name, ruleText: 'Northwind uses HubSpot and Apollo.', type: 'knowledge' });
    await addRule({ orgId: ORG, stepName: gauge.name, ruleText: 'Kestrel owns healthcare-IT.', type: 'knowledge' });

    const known = await objectKnowledge(ORG, ['account/41']);

    expect(known.get('account/41')).toEqual(['Northwind uses HubSpot and Apollo.']);
    expect(known.has('account/77')).toBe(false);

    const crossOrg = await objectKnowledge(OTHER_ORG, ['account/41']);

    expect(crossOrg.size).toBe(0);
  });
});
