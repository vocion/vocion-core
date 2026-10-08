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
