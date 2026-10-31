import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageBreadcrumbs } from '@/features/dashboard/BreadcrumbTrail';
import { SeoStrategyWorkspace } from '@/features/seo/SeoStrategyWorkspace';
import { clerkAuth } from '@/libs/Auth';
import { parseWorkspacePath, workspaceUrl } from '@/libs/links';
import { getDataRoom } from '@/services/DataRoomService';
import { objectCollectionForOrg } from '@/services/objects/objectCollection';

export const metadata = { title: 'SEO strategy roadmap' };

/**
 * The client's actionable SEO strategy and outcome evidence.
 * @param root0
 * @param root0.params
 * @param root0.searchParams
 */
export default async function SeoRoadmapPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ audit?: string; finding?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { orgId, userId } = await clerkAuth();
  const projectId = Number(id);
  if (!orgId || !userId || !Number.isSafeInteger(projectId) || projectId < 1) {
    return notFound();
  }
  const project = await getDataRoom(orgId, projectId);
  if (!project) {
    return notFound();
  }
  const query = await searchParams;
  const auditId = Number(query.audit);
  const collection = await objectCollectionForOrg(orgId, 'data_room');
  const slug = parseWorkspacePath(collection.href)?.slug;
  const path = `/dashboard/projects/${projectId}/roadmap`;
  return (
    <>
      <PageBreadcrumbs pathname={slug ? workspaceUrl(slug, path) : path} crumbs={[{ label: 'Projects', url: '/dashboard/projects?app=seo' }, { label: project.title, url: `/dashboard/projects/${projectId}?app=seo` }, { label: 'Strategy roadmap', url: `${path}?app=seo` }]} />
      <SeoStrategyWorkspace orgId={orgId} userId={userId} projectId={projectId} auditId={Number.isSafeInteger(auditId) && auditId > 0 ? auditId : undefined} findingKey={query.finding} />
    </>
  );
}
