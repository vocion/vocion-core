/**
 * A per-person MCP server enabled in a person's Personal, against PGlite.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, agentSchema, knowledgeSourceSchema, projectMemberSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { personalAssistantSlug } = await import('@/services/workspace/personalAssistant');
const { enablePersonalMcp, personalMcpOffers } = await import('./personalEnable');

const ACCOUNT = 'acct-pme-northwind';
const ALEX = 'usr-pme-alex';
const FINANCE = 'proj-pme-finance';
const URL = 'https://knowledge.northwind.example/mcp';
let personal = '';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-pme' });
  await db.insert(userSchema).values({ id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' });
  await db.insert(accountMembershipSchema).values({ accountId: ACCOUNT, userId: ALEX, role: 'member' });
  await db.insert(projectSchema).values({ id: FINANCE, accountId: ACCOUNT, slug: 'finance-pme', name: 'Finance' });
  await db.insert(projectMemberSchema).values({ projectId: FINANCE, userId: ALEX, role: 'member', source: 'direct', addedBy: ALEX });
  await db.insert(knowledgeSourceSchema).values([
    { orgId: FINANCE, slug: 'company-knowledge', kind: 'plugin', configJson: { _connector: 'mcp', _name: 'Company Knowledge', auth: 'person', url: URL, readTools: ['search_knowledge'] } },
    { orgId: FINANCE, slug: 'ledger', kind: 'plugin', configJson: { _connector: 'mcp', readTools: ['read'] } },
  ]);
  personal = (await ensurePersonalProject(ALEX, ACCOUNT)).id;
});

describe('enabling a per-person MCP server in Personal', () => {
  it('offers only the per-person servers of the person\'s workspaces', async () => {
    await expect(personalMcpOffers(ALEX, personal)).resolves.toEqual([{ fromOrgId: FINANCE, fromWorkspace: 'Finance', slug: 'company-knowledge', name: 'Company Knowledge', url: URL }]);
    await expect(personalMcpOffers(ALEX, FINANCE)).resolves.toEqual([]);
  });

  it('copies the source in and gives it to the personal assistant, then stops offering it', async () => {
    await expect(enablePersonalMcp({ userId: ALEX, personalId: personal, fromOrgId: FINANCE, slug: 'company-knowledge' })).resolves.toEqual({ ok: true, name: 'Company Knowledge' });

    const [source] = await db.select({ config: knowledgeSourceSchema.configJson }).from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.orgId, personal), eq(knowledgeSourceSchema.slug, 'company-knowledge')));

    expect(source?.config).toMatchObject({ _connector: 'mcp', auth: 'person', url: URL, readTools: ['search_knowledge'] });

    const [assistant] = await db.select({ sources: agentSchema.connectorSources }).from(agentSchema).where(and(eq(agentSchema.orgId, personal), eq(agentSchema.slug, personalAssistantSlug())));

    expect(assistant?.sources).toContain('company-knowledge');
    await expect(personalMcpOffers(ALEX, personal)).resolves.toEqual([]);
  });

  it('refuses a server that is not offered', async () => {
    await expect(enablePersonalMcp({ userId: ALEX, personalId: personal, fromOrgId: FINANCE, slug: 'ledger' })).resolves.toMatchObject({ ok: false });
  });
});
