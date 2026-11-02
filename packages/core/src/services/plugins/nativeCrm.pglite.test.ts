import { and, eq } from 'drizzle-orm';
import { beforeAll, expect, it, vi } from 'vitest';
import { readWorkspacePages } from '@/libs/workspace/pages';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { installPluginBundles, retirePluginBundles } = await import('./installBundle');
const { getBusinessObject, listBusinessObjects } = await import('@/services/BusinessObjectService');

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'crm-test-account', name: 'Example', slug: 'crm-test-account' });
  await db.insert(projectSchema).values([
    { id: 'crm-workspace-a', accountId: 'crm-test-account', name: 'A', slug: 'crm-a' },
    { id: 'crm-workspace-b', accountId: 'crm-test-account', name: 'B', slug: 'crm-b' },
  ]);
});

it('installs native CRM idempotently, isolates records, and retains them on disable/re-enable', async () => {
  const opts = { orgId: 'crm-workspace-a', plugins: ['native-crm'], appliedBy: 'test' };
  const first = await installPluginBundles(opts);

  expect(first.errors).toEqual([]);

  const types = await db.select().from(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, opts.orgId));

  expect(types.map(t => t.slug).sort()).toEqual(['crm_activity', 'crm_company', 'crm_contact', 'crm_deal']);

  const company = types.find(t => t.slug === 'crm_company')!;
  const [row] = await db.insert(businessObjectSchema).values({ orgId: opts.orgId, typeId: company.id, title: 'Example Company', metadata: { name: 'Example Company' } }).returning();

  expect(await getBusinessObject(row!.id, 'crm-workspace-b')).toBeUndefined();
  expect(await listBusinessObjects('crm-workspace-b', 'crm_company')).toEqual([]);
  expect((await getBusinessObject(row!.id, opts.orgId))?.title).toBe('Example Company');

  await retirePluginBundles({ orgId: opts.orgId, plugins: ['native-crm'], stillOn: [] });
  const again = await installPluginBundles(opts);

  expect(again.errors).toEqual([]);
  expect(await db.select().from(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, opts.orgId), eq(businessObjectTypeSchema.slug, 'crm_company')))).toHaveLength(1);
  expect((await getBusinessObject(row!.id, opts.orgId))?.typeId).toBe(company.id);
});

it('mounts four native table collections only when enabled', () => {
  const enabled = readWorkspacePages({ enabledPlugins: ['native-crm'], mounted: false, dir: null });

  expect(enabled.issues).toEqual([]);

  const pages = enabled.pages.filter(p => p.slug.startsWith('crm-'));

  expect(pages).toHaveLength(4);
  expect(pages.every(p => p.archetype === 'list' && p.layout === 'table' && p.source?.kind === 'objects')).toBe(true);
  expect(readWorkspacePages({ enabledPlugins: [], mounted: false, dir: null }).pages.some(p => p.slug.startsWith('crm-'))).toBe(false);
});
