import type { MeasureReading } from '@/libs/workspace/appHome';
import type { HomeProject, HomeScope } from '@/services/apps/appHome';
import { getTranslations } from 'next-intl/server';
import { ListRow, ListRows, Section, Stat, StatRow, Subline } from '@/components/patterns';
import { Link } from '@/libs/I18nNavigation';
import { loadHomeActivity, loadHomeDecisions, loadHomeProjects, loadWorkspaceMeasures } from '@/services/apps/appHome';
import { cn } from '@/utils/Helpers';
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
 */
function Figure({ r, timeZone }: { r: MeasureReading; timeZone: string }) {
  const date = r.at ? `${r.atLabel ?? 'as of'} ${dayOf(r.at, timeZone)}` : null;
  const note = [r.note, date].filter(Boolean).join(' · ') || undefined;
  // A figure is a number; a reading in words ("2 of 5 milestones done") is
  // set at body size so it does not shout over the numbers beside it.
  const words = /[a-z]{3}/i.test(r.value.replace(/^[A-Z]{0,3}\$|^€|^£/, ''));
  const value = words ? <span className="block text-[15px] leading-snug font-medium tracking-normal">{r.value}</span> : r.value;
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
 * One cell of the projects table: the figure, its note, and the date it
 * was true as the cell's tooltip (a column of "as of Oct 30" is noise). A
 * count of nothing is quiet, so the row's real numbers stand out.
 * @param props
 * @param props.r - The reading, or none for this project.
 * @param props.timeZone - The workspace's zone.
 */
function Cell({ r, timeZone }: { r: MeasureReading | undefined; timeZone: string }) {
  if (!r) {
    return <span className="text-muted-foreground/60">—</span>;
  }
  const date = r.at ? `${r.atLabel ?? 'as of'} ${dayOf(r.at, timeZone)}` : undefined;
  const nothing = r.value === '0';
  const body = (
    <>
      <span className={cn('tabular-nums', nothing ? 'text-muted-foreground/60' : 'font-medium text-foreground')}>{r.value}</span>
      {r.note && <span className="block text-[12px] text-muted-foreground">{r.note}</span>}
    </>
  );
  return r.href
    ? <Link href={r.href} title={date} className="underline-offset-4 hover:underline" data-testid={`home-measure-${r.key}`}>{body}</Link>
    : <span title={date} data-testid={`home-measure-${r.key}`}>{body}</span>;
}

/**
 * The projects using the app (`home.projects`), one row each and one column
 * per figure, so eight clients read at a glance instead of filling the page.
 * On a phone each project is a short stack: its name, then its figures on
 * one line.
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
  const columns = (scope.app.home.projects?.measures ?? []).filter(m => projects.some(p => p.readings.some(r => r.key === m.key)));
  const readingOf = (p: HomeProject, key: string) => p.readings.find(r => r.key === key);
  return (
    <Section
      eyebrow={t('projects')}
      data-testid="home-projects"
      action={<Link href="/dashboard/projects" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{more > 0 ? t('projects_more', { count: more }) : t('projects_all')}</Link>}
    >
      <table className="hidden w-full border-y border-border/70 text-left text-[14px] sm:table">
        <thead>
          <tr className="text-[12px] text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-normal">{t('project')}</th>
            {columns.map(m => <th key={m.key} scope="col" className="py-2 pr-4 font-normal">{m.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.id} data-testid="home-project" data-project={p.title} className="border-t border-border/50 align-top">
              <th scope="row" className="py-2.5 pr-4 font-medium">
                <Link href={p.href} className="text-foreground underline-offset-4 hover:underline">{p.title}</Link>
              </th>
              {columns.map(m => <td key={m.key} className="py-2.5 pr-4"><Cell r={readingOf(p, m.key)} timeZone={timeZone} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border/50 border-y border-border/70 sm:hidden">
        {projects.map(p => (
          <li key={p.id} data-testid="home-project-phone" data-project={p.title} className="py-2.5">
            <Link href={p.href} className="text-[15px] font-medium text-foreground underline-offset-4 hover:underline">{p.title}</Link>
            {p.readings.length > 0
              ? (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {p.readings.filter(r => r.value !== '0').map(r => `${r.label} ${r.value}`).join(' · ') || t('project_nothing')}
                  </p>
                )
              : <p className="mt-0.5 text-[13px] text-muted-foreground">{t('project_nothing')}</p>}
          </li>
        ))}
      </ul>
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
