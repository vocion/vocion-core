import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, chatChannelBindingSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { connectChannel, connectableWorkspaces } = await import('./connectChannel');
const { resolveBinding } = await import('@/services/ChatSurfaceService');

const ACCOUNT = 'acct-northwind';
const OTHER = 'acct-kestrel';
const admin = { userId: 'u-ada', accountId: ACCOUNT, role: 'admin' as const };
const channel = { surface: 'slack', teamId: 'T1', channelId: 'C9' };

beforeEach(async () => {
  await db.delete(chatChannelBindingSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values([{ id: ACCOUNT, name: 'Northwind', slug: 'northwind' }, { id: OTHER, name: 'Kestrel', slug: 'kestrel' }]);
  await db.insert(projectSchema).values([
    { id: 'proj-growth', accountId: ACCOUNT, slug: 'growth', name: 'Growth', leadAgentSlug: 'growth-lead' },
    { id: 'proj-ops', accountId: ACCOUNT, slug: 'ops', name: 'Ops' },
    { id: 'proj-kestrel', accountId: OTHER, slug: 'kestrel', name: 'Kestrel' },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('connectChannel (2026-10-26: an unbound channel links here)', () => {
  it('lists the admin\'s own Org\'s workspaces only', async () => {
    expect((await connectableWorkspaces(ACCOUNT)).map(w => w.slug)).toEqual(['growth', 'ops']);
  });

  it('binds the channel to the workspace lead, and the next mention resolves there', async () => {
    expect(await connectChannel(admin, { ...channel, projectId: 'proj-growth' })).toEqual({ ok: true, projectId: 'proj-growth', agentSlug: 'growth-lead' });
    expect((await resolveBinding('slack', 'T1', 'C9'))?.orgId).toBe('proj-growth');
  });

  it('falls back to the workspace\'s first active agent when it has no lead, and refuses one with none', async () => {
    expect(await connectChannel(admin, { ...channel, projectId: 'proj-ops' })).toEqual({ ok: false, reason: 'no_agent' });

    await db.insert(agentSchema).values({ orgId: 'proj-ops', slug: 'ops-desk', name: 'Ops desk', systemPrompt: 'test' });

    expect(await connectChannel(admin, { ...channel, projectId: 'proj-ops' })).toMatchObject({ ok: true, agentSlug: 'ops-desk' });
  });

  it('refuses a member, another Org\'s workspace, a channel already connected, and a team this installation does not serve', async () => {
    expect(await connectChannel({ ...admin, role: 'member' }, { ...channel, projectId: 'proj-growth' })).toEqual({ ok: false, reason: 'not_admin' });
    expect(await connectChannel(admin, { ...channel, projectId: 'proj-kestrel' })).toEqual({ ok: false, reason: 'not_your_workspace' });

    await connectChannel(admin, { ...channel, projectId: 'proj-growth' });

    expect(await connectChannel(admin, { ...channel, projectId: 'proj-growth' })).toEqual({ ok: false, reason: 'already_connected' });

    vi.stubEnv('SLACK_TEAM_ID', 'T-OURS');

    expect(await connectChannel(admin, { ...channel, channelId: 'C10', projectId: 'proj-growth' })).toEqual({ ok: false, reason: 'other_team' });
    expect(await connectChannel(admin, { surface: 'slack', teamId: 'T1', channelId: '*', projectId: 'proj-growth' })).toEqual({ ok: false, reason: 'bad_request' });
  });
});
