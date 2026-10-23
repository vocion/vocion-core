import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The `@` picker's sources: what this workspace declares and the person can
 * read, plus the person's own servers that join their turns here
 * (`followingSources.ts`), marked as theirs.
 */

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ synthesizeAgentChips: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));
vi.mock('@/services/SourceAccessService', () => ({ allowedSourceSlugsForUser: async () => ['crm'] }));
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { tagSources } = await import('./Chat');

const ACCOUNT = 'acct-tag-northwind';
const ALEX = 'usr-tag-alex';
const FINANCE = 'proj-tag-finance';
const REVENUE = 'proj-tag-revenue';

function call<T = unknown>(route: unknown): Promise<T> {
  return (route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } })['~orpc'].handler({ input: undefined, context: {} });
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-tag' });
  await db.insert(userSchema).values({ id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' });
  await db.insert(accountMembershipSchema).values({ accountId: ACCOUNT, userId: ALEX, role: 'member' });
  await db.insert(projectSchema).values([
    { id: FINANCE, accountId: ACCOUNT, slug: 'finance-tag', name: 'Finance' },
    { id: REVENUE, accountId: ACCOUNT, slug: 'revenue-tag', name: 'Revenue' },
  ]);
  await db.insert(knowledgeSourceSchema).values([
    { orgId: FINANCE, slug: 'company-knowledge', kind: 'plugin', configJson: { _connector: 'mcp', _name: 'Company Knowledge', auth: 'person', url: 'https://knowledge.northwind.example/mcp', readTools: ['search_knowledge'] } },
    { orgId: REVENUE, slug: 'crm', kind: 'plugin', configJson: { _connector: 'hubspot', _name: 'HubSpot' } },
  ]);
  vi.mocked(guardAuth).mockResolvedValue({ userId: ALEX, orgId: REVENUE, accountId: ACCOUNT, has: () => false } as never);
});

describe('the @ picker', () => {
  it('lists the person\'s own connection beside this workspace\'s sources', async () => {
    const res = await call<{ sources: Array<{ slug: string; name: string; yours?: boolean; from?: string }> }>(tagSources);

    expect(res.sources).toEqual([
      { slug: 'crm', name: 'HubSpot' },
      { slug: 'company-knowledge', name: 'Company Knowledge', yours: true, from: 'Finance' },
    ]);
  });
});
