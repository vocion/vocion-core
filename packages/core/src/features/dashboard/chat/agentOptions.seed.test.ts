/**
 * Opening chat in a workspace with nobody in it seeds its lead, once, for
 * that workspace only — the lazy half of `services/workspace/workspaceLead.ts`
 * for workspaces made before the lead existed.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { loadChatAgentContext } = await import('./agentOptions');
const { WORKSPACE_LEAD_SLUG } = await import('@/libs/workspace/workspaceLead');

const OPENED = 'proj-chat-seed-opened';
const UNOPENED = 'proj-chat-seed-unopened';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-chat-seed', name: 'Contoso', slug: 'contoso-chat-seed' });
  await db.insert(projectSchema).values([
    { id: OPENED, accountId: 'acct-chat-seed', slug: 'ops', name: 'Contoso Ops' },
    { id: UNOPENED, accountId: 'acct-chat-seed', slug: 'finance', name: 'Contoso Finance' },
  ]);
});

describe('loadChatAgentContext on an empty workspace', () => {
  it('opens on the seeded lead, idempotently, and touches no other workspace', async () => {
    const first = await loadChatAgentContext(OPENED);
    const second = await loadChatAgentContext(OPENED);

    expect(first.agents.map(a => a.slug)).toEqual([WORKSPACE_LEAD_SLUG, '__search__']);
    expect(first.coordinatorSlug).toBe(WORKSPACE_LEAD_SLUG);
    expect(second.agents.map(a => a.slug)).toEqual([WORKSPACE_LEAD_SLUG, '__search__']);
    expect(await db.select().from(agentSchema).where(eq(agentSchema.orgId, OPENED))).toHaveLength(1);
    expect(await db.select().from(agentSchema).where(eq(agentSchema.orgId, UNOPENED))).toHaveLength(0);
  });
});

describe('a Personal workspace that lost its assistant heals when its person opens chat (Metacto, 2026-10-09)', () => {
  const HOME = 'proj-chat-seed-home';

  it('reseeds the assistant its lead names, and introduces it as the person\'s own', async () => {
    // The state on the box: the lead names `assistant`, with no row behind it.
    await db.insert(projectSchema).values({ id: HOME, accountId: 'acct-chat-seed', slug: 'personal-chat-seed', name: 'Personal', kind: 'personal', leadAgentSlug: 'assistant' });

    const ctx = await loadChatAgentContext(HOME);
    const assistant = ctx.agents.find(a => a.slug === 'assistant');

    expect(ctx.agents.map(a => a.slug)).toEqual(['assistant', '__search__']);
    expect(ctx.coordinatorSlug).toBe('assistant');
    expect(assistant).toMatchObject({ personal: true, leadRole: 'personal assistant on Contoso' });
    expect(assistant?.givenName).toBeUndefined();
    // Never a workspace lead in somebody's own workspace.
    expect((await db.select().from(agentSchema).where(eq(agentSchema.orgId, HOME))).map(a => a.slug)).toEqual(['assistant']);
  });

  it('once the person names it, it is that name', async () => {
    await db.update(agentSchema).set({ name: 'Ziggy' }).where(eq(agentSchema.orgId, HOME));

    const ctx = await loadChatAgentContext(HOME);

    expect(ctx.agents[0]).toMatchObject({ slug: 'assistant', name: 'Ziggy', givenName: 'Ziggy', personal: true });
  });
});
