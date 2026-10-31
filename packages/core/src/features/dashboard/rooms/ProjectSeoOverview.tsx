import type { RecordRef } from '@/services/chat/pageContext';
import type { SeoAuditRecord } from '@/services/seo/audits';
import type { SeoProfile } from '@/services/seo/profile';
import type { SeoStrategyMeta } from '@/services/seo/strategy';
import { Section } from '@/components/patterns';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { Link } from '@/libs/I18nNavigation';
import { GOAL_LABEL } from '@/services/seo/profile';

/**
 * The client's next decisions and existing work, before the reference material.
 * @param root0
 * @param root0.record
 * @param root0.profile
 * @param root0.draftReady
 * @param root0.audit
 * @param root0.strategy
 */
export function ProjectSeoOverview({ record, profile, draftReady, audit, strategy }: {
  record: RecordRef;
  profile: SeoProfile | null;
  draftReady: boolean;
  audit: SeoAuditRecord | null;
  strategy: { id: number; meta: SeoStrategyMeta } | null;
}) {
  const projectId = record.id;
  // Older persisted records predate the current audit and strategy schemas.
  const goals = Array.isArray(profile?.goals) ? profile.goals.filter(g => g in GOAL_LABEL) : [];
  const strategyMeta = strategy?.meta;
  const pendingMilestones = Array.isArray(strategyMeta?.milestones) ? strategyMeta.milestones.filter(m => m && !m.done && typeof m.label === 'string') : [];
  const auditMeta = audit?.meta;
  const nextSteps = Array.isArray(auditMeta?.nextSteps) ? auditMeta.nextSteps.filter(step => typeof step === 'string' && step.trim()) : [];
  const openCount = typeof auditMeta?.openCount === 'number' && Number.isFinite(auditMeta.openCount) && auditMeta.openCount >= 0 ? `${auditMeta.openCount} open findings` : 'Open findings not recorded';
  const highCount = typeof auditMeta?.highCount === 'number' && Number.isFinite(auditMeta.highCount) && auditMeta.highCount >= 0 ? `${auditMeta.highCount} high` : 'Severity count not recorded';
  const checkedAt = typeof auditMeta?.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(auditMeta.checkedAt) && Number.isFinite(Date.parse(auditMeta.checkedAt)) ? `checked ${auditMeta.checkedAt.slice(0, 10)}` : 'Check date not recorded';
  return (
    <Section eyebrow="SEO overview" data-testid="project-seo-overview">
      <div className="rounded-xl border border-border bg-muted/20 p-4 sm:p-5">
        <p className="text-lg font-semibold text-foreground">{strategyMeta?.goalTitle || (goals.length ? goals.map(g => GOAL_LABEL[g]).join(' → ') : 'Set the outcome this client needs')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {strategy ? (strategyMeta?.goalStatus === 'drafted' ? 'Strategy drafted · awaiting the goal decision' : strategyMeta?.progressLine || strategyMeta?.goalStatus || 'Strategy status not recorded') : 'No strategy recorded yet. Confirm the business priorities before planning work.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <AskAboutThis record={record} label="Plan next steps" agentSlug="seo-strategist" send prompt="Review this project's approved SEO profile, current strategy and latest audit. Propose the next few actions from existing evidence. Ask for missing business priorities; do not invent goals or start a new audit unless needed." />
          <Link href={`/dashboard/p/seo-pages?project=${projectId}`} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-hover">Open pages</Link>
          <Link href={`/dashboard/p/seo-audits?project=${projectId}`} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-hover">Audit history</Link>
          <Link href={`/dashboard/projects/${projectId}/roadmap?app=seo`} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-hover">Strategy roadmap</Link>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Needs a decision</h3>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            {draftReady && (
              <li>
                <a href="#seo-profile" className="text-foreground underline underline-offset-4">Review the prepared profile</a>
                {' '}
                · saved as a draft; it has not replaced the approved profile.
              </li>
            )}
            {!goals.length && (
              <li>
                <a href="#seo-profile" className="text-foreground underline underline-offset-4">Choose the business priorities</a>
                {' '}
                · the site cannot tell us the client's goals.
              </li>
            )}
            {strategy && strategyMeta?.goalStatus === 'drafted' && (
              <li>
                <Link href={`/dashboard/objects/${strategy.id}`} className="text-foreground underline underline-offset-4">Review the strategy goal</Link>
                {' '}
                before treating it as an active commitment.
              </li>
            )}
            {!draftReady && goals.length > 0 && strategyMeta?.goalStatus !== 'drafted' && (
              <li>
                No profile or strategy decision identified here. Page sign-offs are under
                {' '}
                <Link href={`/dashboard/p/seo-pages?project=${projectId}&status=in_review`} className="text-foreground underline underline-offset-4">pages awaiting review</Link>
                .
              </li>
            )}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Next work from evidence</h3>
          {audit
            ? (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">
                    <Link href={`/dashboard/objects/${audit.id}`} className="text-foreground underline underline-offset-4">Latest audit</Link>
                    {` · ${openCount} · ${highCount} · ${checkedAt}`}
                  </p>
                  {nextSteps.length > 0 && <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{nextSteps.slice(0, 3).map(step => <li key={step}>{step}</li>)}</ol>}
                </>
              )
            : <p className="mt-2 text-sm text-muted-foreground">No audit available here. Ask the strategist whether research is needed for the next decision.</p>}
          {pendingMilestones.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">Next strategy milestone: </span>
              {pendingMilestones[0]!.href ? <Link href={pendingMilestones[0]!.href!} className="underline underline-offset-4">{pendingMilestones[0]!.label}</Link> : pendingMilestones[0]!.label}
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}
