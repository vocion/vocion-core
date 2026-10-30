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
