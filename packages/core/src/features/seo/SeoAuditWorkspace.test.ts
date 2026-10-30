import { expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./SeoAuditWorkView', () => ({ SeoAuditWorkView: () => null }));
vi.mock('@/services/seo/audits', () => ({ getAudit: vi.fn() }));
vi.mock('@/services/DataRoomService', () => ({ getDataRoom: vi.fn(async () => null) }));
const { db } = await import('@/libs/DB');
const { askSchema } = await import('@/models/Schema');
const { getAudit } = await import('@/services/seo/audits');
const { SeoAuditWorkspace } = await import('./SeoAuditWorkspace');

it('reads linked tasks only in this workspace and constructs their canonical URLs', async () => {
  await db.delete(askSchema);
  const [here, foreign] = await db.insert(askSchema).values([
    { orgId: 'audit-here', kind: 'input', title: 'Own task', status: 'open' },
    { orgId: 'audit-there', kind: 'input', title: 'Foreign private task', status: 'done' },
  ]).returning();
  vi.mocked(getAudit).mockResolvedValue({
    id: 17,
    title: 'Audit',
    createdAt: new Date(),
    meta: { projectId: 9, findings: [here!, foreign!].map(t => ({ fix: { kind: 'task', id: t.id, href: '/w/other/dashboard/inbox/999' } })) },
  } as never);
  const rendered = await SeoAuditWorkspace({ orgId: 'audit-here', objectId: 17, title: 'Untrusted title', meta: {} });

  expect(getAudit).toHaveBeenCalledWith('audit-here', 17);
  expect(rendered.props.linkedWork).toEqual([{ kind: 'task', id: here!.id, title: 'Own task', status: 'open', href: `/dashboard/inbox/${here!.id}` }]);
});

it('uses SEO workflow metadata, never generic record status, and skips missing projects', async () => {
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const { getDataRoom } = await import('@/services/DataRoomService');
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: 'audit-pages', slug: 'seo_page', label: 'Page' }).returning();
  const rows = await db.insert(businessObjectSchema).values([
    { orgId: 'audit-pages', typeId: type!.id, title: 'Review page', status: 'active', metadata: { status: 'in_review' } },
    { orgId: 'audit-pages', typeId: type!.id, title: 'Legacy page', status: 'active', metadata: {} },
    { orgId: 'audit-foreign', typeId: type!.id, title: 'Foreign page', metadata: { status: 'approved' } },
  ]).returning();
  vi.mocked(getDataRoom).mockClear();
  vi.mocked(getAudit).mockResolvedValue({ id: 17, meta: { findings: rows.map(p => ({ fix: { kind: 'page', id: p.id } })) } } as never);
  const rendered = await SeoAuditWorkspace({ orgId: 'audit-pages', objectId: 17, title: '', meta: {} });

  expect(getDataRoom).not.toHaveBeenCalled();
  expect(rendered.props.linkedWork).toEqual([
    { id: rows[0]!.id, title: 'Review page', status: 'in_review', kind: 'page', href: `/dashboard/objects/${rows[0]!.id}` },
    { id: rows[1]!.id, title: 'Legacy page', status: null, kind: 'page', href: `/dashboard/objects/${rows[1]!.id}` },
  ]);
});
