import type { AuditLinkedWork } from './SeoAuditWorkView';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { askSchema, businessObjectSchema } from '@/models/Schema';
import { getDataRoom } from '@/services/DataRoomService';
import { getAudit } from '@/services/seo/audits';
import { SEO_PAGE_STATUSES } from '@/services/seo/records';
import { SeoAuditWorkView } from './SeoAuditWorkView';

/**
 * Reload the audit and its linked work under the route's workspace boundary.
 * @param root0
 * @param root0.orgId
 * @param root0.objectId
 * @param root0.title
 * @param root0.meta
 */
export async function SeoAuditWorkspace({ orgId, objectId }: { orgId: string; objectId: number; title: string; meta: Record<string, unknown> }) {
  const audit = await getAudit(orgId, objectId);
  if (!audit || !Array.isArray(audit.meta?.findings)) {
    return <p className="text-sm text-muted-foreground">This audit is unavailable in this workspace.</p>;
  }
  const fixes = audit.meta.findings.flatMap(f => f.fix ? [f.fix] : []);
  const taskIds = [...new Set(fixes.filter(f => f.kind === 'task').map(f => f.id))];
  const pageIds = [...new Set(fixes.filter(f => f.kind === 'page').map(f => f.id))];
  const [project, tasks, pages] = await Promise.all([
    Number.isSafeInteger(audit.meta.projectId) && audit.meta.projectId > 0 ? getDataRoom(orgId, audit.meta.projectId) : Promise.resolve(null),
    taskIds.length ? db.select({ id: askSchema.id, title: askSchema.title, status: askSchema.status }).from(askSchema).where(and(eq(askSchema.orgId, orgId), inArray(askSchema.id, taskIds))) : Promise.resolve([]),
    pageIds.length ? db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, pageIds))) : Promise.resolve([]),
  ]);
  const linkedWork: AuditLinkedWork[] = [
    ...tasks.map(t => ({ ...t, kind: 'task' as const, href: `/dashboard/inbox/${t.id}` })),
    ...pages.map(p => ({ id: p.id, title: p.title, status: SEO_PAGE_STATUSES.find(status => status === p.metadata?.status) ?? null, kind: 'page' as const, href: `/dashboard/objects/${p.id}` })),
  ];
  return <SeoAuditWorkView audit={audit} profile={project?.meta.seoProfile} linkedWork={linkedWork} />;
}
