import { and, eq } from 'drizzle-orm';
import { Activity, CalendarClock, NotebookPen, Plus, Target, Users } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { MissionCheckButton } from '@/features/dashboard/MissionCheckButton';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { readPrimitiveFiles } from '@/libs/workspace/reader';
import { missionSchema } from '@/models/Schema';
import { listAutomations } from '@/services/AutomationService';
import { isEntityStatus } from '@/types/Status';

/**
 * Mission detail — the charter, in full. A mission is an OBJECTIVE a team
 * owns: goal, success criteria, team, autonomy. The cadence lives on
 * whichever automations check it; the run history shows the checks.
 * The backing YAML is viewable/editable inline (writes go through the
 * workspace writer and re-apply).
 * @param props
 * @param props.params
 */
export default async function MissionDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }

  const [mission] = await db
    .select()
    .from(missionSchema)
    .where(and(eq(missionSchema.orgId, orgId), eq(missionSchema.slug, slug)));
  if (!mission) {
    notFound();
  }

  const automations = await listAutomations(orgId);
  const checkers = automations.filter(a => a.doConfig.checkMission === slug && a.status === 'active');
  const sourceFiles = readPrimitiveFiles('mission', slug);
  const team = mission.defaultTeam;

  return (
    <>
      <TitleBar
        title={mission.name}
        description={mission.description ?? 'Standing mission'}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusPill status={mission.status && isEntityStatus(mission.status) ? mission.status : 'inactive'} />
        <MissionCheckButton slug={slug} />
        <Link
          href={`/dashboard/missions/new?template=${slug}`}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium transition hover:bg-muted"
        >
          <Plus className="size-4" />
          Brief ad-hoc work
        </Link>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-border p-5">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <Target className="size-4 text-primary" />
            Goal
          </h2>
          <p className="text-sm leading-relaxed">{mission.goal}</p>
          {(mission.successCriteria ?? []).length > 0 && (
            <>
              <h3 className="mt-4 mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Success criteria</h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground/85">
                {(mission.successCriteria ?? []).map(c => <li key={c.slice(0, 40)}>{c}</li>)}
              </ul>
            </>
          )}
          {(mission.desiredArtifacts ?? []).length > 0 && (
            <>
              <h3 className="mt-4 mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Deliverables</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {(mission.desiredArtifacts ?? []).map(a => <li key={a.slice(0, 40)}>{a}</li>)}
              </ul>
            </>
          )}
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-md border border-border p-5">
            <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
              <Users className="size-4 text-primary" />
              Team
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/dashboard/agents/${team.lead}`} className="rounded-full border border-border px-2.5 py-1 font-medium hover:bg-muted">
                {team.lead}
                {' '}
                <span className="text-[10px] text-muted-foreground uppercase">lead</span>
              </Link>
              {team.members.map(m => (
                <Link key={m} href={`/dashboard/agents/${m}`} className="rounded-full border border-border px-2.5 py-1 hover:bg-muted">
                  {m}
                </Link>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Autonomy level
              {' '}
              {(mission.autonomyPolicy as { level?: number } | null)?.level ?? 1}
              {' '}
              — external actions ride the review queue.
            </p>
          </section>

          <section className="rounded-md border border-border p-5">
            <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
              <CalendarClock className="size-4 text-primary" />
              Checked by
            </h2>
            {checkers.length === 0
              ? <p className="text-sm text-muted-foreground">No automation checks this mission — it runs only when briefed. Add one in workspace/…/automations/.</p>
              : checkers.map(a => (
                  <div key={a.slug} className="flex items-center gap-2 border-b border-border py-1.5 text-sm last:border-0">
                    <Link href="/dashboard/automation" className="font-medium hover:underline">{a.name}</Link>
                    {a.whenConfig.schedule && (
                      <span className="text-xs text-muted-foreground" title={a.whenConfig.schedule}>{cronToText(a.whenConfig.schedule)}</span>
                    )}
                    {a.whenConfig.event && (
                      <code className="font-mono text-xs text-muted-foreground">
                        on
                        {' '}
                        {a.whenConfig.event}
                      </code>
                    )}
                  </div>
                ))}
          </section>
        </div>
      </div>

      {mission.workingNotes && (
        <section className="mb-6 rounded-md border border-border p-5">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <NotebookPen className="size-4 text-primary" />
            Working notes
            <span className="text-xs font-normal text-muted-foreground">the team's memory between checks — open threads, commitments, escalation</span>
          </h2>
          <pre className="max-h-72 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-foreground/85">{mission.workingNotes}</pre>
        </section>
      )}

      <div className="mb-6">
        <Link
          href={`/dashboard/activity?kind=mission&slug=${slug}`}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <Activity className="size-4" />
          View this mission's runs in Activity
          <span aria-hidden>→</span>
        </Link>
      </div>

      {sourceFiles && (
        <PrimitiveFiles
          files={sourceFiles.files}
          editInGitPath={sourceFiles.editInGitPath}
        />
      )}
    </>
  );
}
