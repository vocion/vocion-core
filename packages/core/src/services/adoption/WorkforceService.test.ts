import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/analytics/amplitudeKey', () => ({
  amplitudeKeyStatus: vi.fn(async () => ({ effective: 'instance', instance: { hint: 'secret-hint' }, workspace: null })),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, teamSchema, projectSchema, tenantAccountSchema, userSchema, userActivityEventSchema, toolCallSchema } = await import('@/models/Schema');
const { getWorkforceInventory } = await import('./WorkforceService');
const now = new Date();

beforeEach(async () => {
  await db.delete(toolCallSchema);
  await db.delete(userActivityEventSchema);
  await db.delete(agentSchema);
  await db.delete(teamSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);
  await db.insert(userSchema).values({ id: 'owner', email: 'owner@example.test' });
  await db.insert(tenantAccountSchema).values({ id: 'account', name: 'Account', slug: 'account' });
  await db.insert(projectSchema).values([
    { id: 'a', accountId: 'account', name: 'A', slug: 'a', accountableUserId: 'owner' },
    { id: 'b', accountId: 'account', name: 'B', slug: 'b' },
  ]);
  await db.insert(teamSchema).values([
    { orgId: 'a', slug: 'team', name: 'Team', goal: 'Draft work' },
    { orgId: 'a', slug: 'empty', name: 'Empty' },
    { orgId: 'b', slug: 'team', name: 'Other tenant' },
  ]);
  await db.insert(agentSchema).values([
    { orgId: 'a', slug: 'used', name: 'Used', systemPrompt: 'private', teamSlug: 'team' },
    { orgId: 'a', slug: 'unused', name: 'Unused', systemPrompt: 'private', active: 'false' },
    { orgId: 'a', slug: 'unknown', name: 'Unknown', systemPrompt: 'private', active: null },
    { orgId: 'b', slug: 'used', name: 'Other tenant', systemPrompt: 'private' },
  ]);
});

describe('workforce inventory', () => {
  it('keeps unused, disabled and unknown agents and empty teams; inherits ownership', async () => {
    const report = await getWorkforceInventory('a', 30);

    expect(report.agents).toHaveLength(3);
    expect(report.teams).toHaveLength(2);
    expect(report.agents.find(a => a.slug === 'unused')).toMatchObject({ enabled: false, humanEvents: 0, lastToolCallAt: null });
    expect(report.agents.find(a => a.slug === 'unknown')?.enabled).toBeNull();
    expect(report.agents.find(a => a.slug === 'used')?.ownerUserId).toBe('owner');
    expect(report.coverage).toMatchObject({ localEvents: 0, lastLocalEventAt: null, completeness: 'unverified', amplitudeDelivery: 'unverified' });
    expect(JSON.stringify(report)).not.toContain('secret-hint');
    expect(JSON.stringify(report)).not.toContain('systemPrompt');
  });

  it('scopes identical slugs, excludes machine/heartbeat/old/future human actions and includes background tools', async () => {
    const event = { orgId: 'a', agentSlug: 'used', userId: 'person', eventType: 'chat.message_sent', createdAt: now };
    await db.insert(userActivityEventSchema).values([
      event,
      { ...event, orgId: 'b' },
      { ...event, userId: 'automation:daily' },
      { ...event, userId: 'system' },
      { ...event, eventType: 'activity.heartbeat' },
      { ...event, createdAt: new Date(now.getTime() - 40 * 86_400_000) },
      { ...event, createdAt: new Date(now.getTime() + 86_400_000) },
      { ...event, agentSlug: 'removed' },
    ]);
    await db.insert(toolCallSchema).values([
      { orgId: 'a', agentSlug: 'used', tool: 'test', createdBy: 'automation:daily', error: 'failed', createdAt: now },
      { orgId: 'b', agentSlug: 'used', tool: 'test', createdAt: now },
    ]);
    const report = await getWorkforceInventory('a', 7);

    expect(report.agents.find(a => a.slug === 'used')).toMatchObject({ humanEvents: 1, toolCalls: 1 });
    expect(report.coverage.unlinkedAgentEvents).toBe(1);
    expect(report.agents.some(a => a.name === 'Other tenant')).toBe(false);
    expect(report.teams.some(a => a.name === 'Other tenant')).toBe(false);
    expect(report.window.days).toBe(7);
  });
});
