import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Link } from '@/libs/I18nNavigation';
import { getDataRoom } from '@/services/DataRoomService';
import { getAudit } from '@/services/seo/audits';
import { readSeoReadiness } from '@/services/seo/readiness';
import { readSeoRoadmap } from '@/services/seo/roadmap';
import { SeoMeasurementActions } from './SeoMeasurementActions';
import { SeoReadinessPanel } from './SeoReadinessPanel';
import { SeoRoadmapView } from './SeoRoadmapView';

/**
 * One client work surface, reached from either its strategy record or project.
 * @param root0
 * @param root0.orgId
 * @param root0.userId
 * @param root0.projectId
 * @param root0.auditId
 * @param root0.findingKey
 */
export async function SeoStrategyWorkspace({ orgId, userId, projectId, auditId, findingKey }: { orgId: string; userId: string; projectId: number; auditId?: number; findingKey?: string }) {
  const project = await getDataRoom(orgId, projectId);
  if (!project) {
    return notFound();
  }
  const [state, readiness, audit] = await Promise.all([
    readSeoRoadmap(orgId, projectId, userId),
    readSeoReadiness(orgId, projectId),
    auditId ? getAudit(orgId, auditId) : Promise.resolve(null),
  ]);
  const finding = audit?.meta.projectId === projectId ? audit.meta.findings?.find(f => f.key === findingKey) : undefined;
  const suggestion = finding ? { label: finding.title, rationale: finding.evidence, evidence: [{ label: 'Audit evidence', url: `/dashboard/objects/${audit!.id}?app=seo#finding-${encodeURIComponent(finding.key)}` }] } : undefined;
  const strategy = state.strategy?.meta;
  return (
    <div className="space-y-7">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            {project.title}
            {' '}
            · SEO strategy
          </p>
          <h1 className="mt-2 max-w-3xl text-2xl font-semibold">{strategy?.goalTitle || 'Turn client priorities into a delivery plan'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{strategy?.goalStatus === 'drafted' ? 'Draft strategy · awaiting approval' : strategy?.goalStatus ? `${strategy.goalStatus} · ${strategy.horizon || 'Horizon not set'}` : 'No approved strategy yet. Confirm the goal, horizon, and accountable owner.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/dashboard/projects/${projectId}?app=seo`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Client project</Link>
          {strategy?.goalId && <Link href={`/dashboard/goals/${strategy.goalId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Goal & weekly review</Link>}
          {strategy?.documentArtifactId && <Link href={`/dashboard/artifacts/${strategy.documentArtifactId}?app=seo`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Strategy document</Link>}
          <Link href={`/dashboard/chat?app=seo&ask=${encodeURIComponent(`Review project ${projectId}'s SEO strategy and evidence. ${state.strategy ? 'Propose a revision without replacing the approved strategy until I approve.' : 'Ask for missing business priorities and horizon, then draft an owned strategy with linked milestones.'}`)}`} className={buttonVariants({ size: 'sm' })}>{state.strategy ? 'Review strategy' : 'Draft strategy'}</Link>
        </div>
      </section>
      {readiness && (
        <details className="rounded-xl border border-border">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
            Client readiness ·
            {readiness.checks.filter(c => c.state !== 'ready').length}
            {' '}
            evidence or setup gaps
          </summary>
          <SeoReadinessPanel readiness={readiness} />
        </details>
      )}
      <SeoRoadmapView key={`${projectId}-${state.roadmap.revision}`} projectId={projectId} initial={state.roadmap} canEdit={state.canEdit} records={state.availableRecords} tasks={state.availableTasks} owners={state.availableOwners} suggestion={suggestion} />
      <SeoMeasurementActions projectId={projectId} revision={state.roadmap.revision} canEdit={state.canEdit} />
    </div>
  );
}
