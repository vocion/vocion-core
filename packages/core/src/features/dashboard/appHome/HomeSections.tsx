import type { MeasureReading } from '@/libs/workspace/appHome';
import type { HomeScope } from '@/services/apps/appHome';
import { getTranslations } from 'next-intl/server';
import { ListRow, ListRows, Section, Stat, StatRow, Subline } from '@/components/patterns';
import { Link } from '@/libs/I18nNavigation';
import { loadHomeActivity, loadHomeDecisions, loadHomeProjects, loadWorkspaceMeasures } from '@/services/apps/appHome';
import { HomeDecisions } from './HomeDecisions';

/**
 * The streamed sections of an app's home, each its own server component
 * under its own `<Suspense>` (`dashboard/apps/[app]/home/page.tsx`), so a slow
 * figure holds up only its section. Each one renders nothing when it has
 * nothing (reduction: no empty headers).
 */

/**
 * A day as the person reads it, in the workspace's zone: "Oct 28".
 * @param iso - The moment.
 * @param timeZone - The workspace's zone.
 */
function dayOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(new Date(iso));
}

/**
 * One figure: the number, its one-line note, and the date it was true,
 * linked to where it came from.
 * @param props
 * @param props.r - The reading.
 * @param props.timeZone - The workspace's zone.
 * @param props.compact
 */
function Figure({ r, timeZone, compact = false }: { r: MeasureReading; timeZone: string; compact?: boolean }) {
  const date = r.at ? `${r.atLabel ?? 'as of'} ${dayOf(r.at, timeZone)}` : null;
  const note = [r.note, date].filter(Boolean).join(' · ') || undefined;
  // A figure is a number; a reading in words ("2 of 5 milestones done") is
  // set at body size so it does not shout over the numbers beside it.
  const words = /[a-z]{3}/i.test(r.value.replace(/^[A-Z]{0,3}\$|^€|^£/, ''));
  const value = words || compact ? <span className="block text-[15px] leading-snug font-medium tracking-normal">{r.value}</span> : r.value;
  return <Stat id={r.key} data-testid={`home-measure-${r.key}`} label={r.label} value={value} note={note} href={r.href ?? undefined} />;
}

/**
 * Needs you: the app's open Decisions, decided in place.
 * @param props
 * @param props.orgId - The workspace.
 * @param props.userId - The person.
 * @param props.scope - The app.
 */
export async function NeedsYouSection({ orgId, userId, scope }: { orgId: string; userId: string; scope: HomeScope }) {
  const [decisions, t] = await Promise.all([loadHomeDecisions(orgId, userId, scope).catch(() => []), getTranslations('AppHome')]);
  if (decisions.length === 0) {
    return null;
  }
  return (
    <HomeDecisions
      decisions={decisions}
      agentNames={scope.agentNames}
      labels={{ title: t('needs_you'), inChat: t('needs_you_in_chat'), openChat: t('needs_you_open_chat'), failed: t('needs_you_failed') }}
    />
  );
}

/**
 * Where things stand across the workspace (`home.measures`).
 * @param props
 * @param props.orgId - The workspace.
 * @param props.userId - The person.
 * @param props.scope - The app.
 * @param props.timeZone - The workspace's zone.
 */
export async function StandingSection({ orgId, userId, scope, timeZone }: { orgId: string; userId: string; scope: HomeScope; timeZone: string }) {
  const [readings, t] = await Promise.all([loadWorkspaceMeasures(orgId, userId, scope).catch(() => []), getTranslations('AppHome')]);
  if (readings.length === 0) {
    return null;
  }
  return (
    <Section eyebrow={t('standing')} data-testid="home-standing">
      <StatRow className="grid-cols-2">
        {readings.map(r => <Figure key={r.key} r={r} timeZone={timeZone} />)}
      </StatRow>
    </Section>
  );
}

/**
 * One block per project using the app (`home.projects`): its name, linked
 * to the project, and its figures.
 * @param props
 * @param props.orgId - The workspace.
 * @param props.scope - The app.
 * @param props.timeZone - The workspace's zone.
 */
export async function ProjectsSection({ orgId, scope, timeZone }: { orgId: string; scope: HomeScope; timeZone: string }) {
  const [{ projects, more }, t] = await Promise.all([loadHomeProjects(orgId, scope).catch(() => ({ projects: [], more: 0 })), getTranslations('AppHome')]);
  if (projects.length === 0) {
    return null;
  }
  return (
    <Section
      eyebrow={t('projects')}
      data-testid="home-projects"
      action={<Link href="/dashboard/projects" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{more > 0 ? t('projects_more', { count: more }) : t('projects_all')}</Link>}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {projects.map(p => (
          <div key={p.id} data-testid="home-project" data-project={p.title} className="rounded-xl border border-border/70 p-4">
            <Link href={p.href} className="text-[15px] font-semibold text-foreground underline-offset-4 hover:underline">{p.title}</Link>
            {p.readings.length > 0
              ? (
                  <StatRow className="mt-3 grid-cols-2 gap-3 border-0 py-0 sm:grid-cols-2">
                    {p.readings.map(r => <Figure key={r.key} r={r} timeZone={timeZone} compact />)}
                  </StatRow>
                )
              : <p className="mt-1 text-[13px] text-muted-foreground">{t('project_nothing')}</p>}
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * Running now and recently made by the app's agents.
 * @param props
 * @param props.orgId - The workspace.
 * @param props.scope - The app.
 * @param props.timeZone - The workspace's zone.
 */
export async function ActivitySection({ orgId, scope, timeZone }: { orgId: string; scope: HomeScope; timeZone: string }) {
  const [{ running, recent }, t] = await Promise.all([loadHomeActivity(orgId, scope).catch(() => ({ running: [], recent: [] })), getTranslations('AppHome')]);
  return (
    <>
      {running.length > 0 && (
        <Section eyebrow={t('running')} data-testid="home-running">
          <ListRows className="border-y border-border/70">
            {running.map(i => <ListRow key={i.key} href={i.href} title={i.title} subline={<Subline separator="·" segments={[t(`run_state.${i.state}` as 'run_state.running'), t('started', { date: dayOf(i.at, timeZone) })]} />} />)}
          </ListRows>
        </Section>
      )}
      {recent.length > 0 && (
        <Section eyebrow={t('recent')} data-testid="home-recent">
          <ListRows className="border-y border-border/70">
            {recent.map(i => <ListRow key={i.key} href={i.href} title={i.title} subline={t('updated', { date: dayOf(i.at, timeZone) })} />)}
          </ListRows>
        </Section>
      )}
    </>
  );
}

/**
 * A section's placeholder while it streams in: its eyebrow and a quiet line.
 * @param root0
 * @param root0.eyebrow
 */
export function SectionPending({ eyebrow }: { eyebrow: string }) {
  return (
    <Section eyebrow={eyebrow}>
      <div className="h-16 animate-pulse rounded-lg bg-muted/40" aria-hidden />
    </Section>
  );
}
