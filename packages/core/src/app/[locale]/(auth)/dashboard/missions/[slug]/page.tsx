import { and, eq } from 'drizzle-orm';
import { Activity, CalendarClock, FileCode2, NotebookPen, Plus, Target, Users } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { StandaloneArtifactView } from '@/features/dashboard/artifacts/StandaloneArtifactView';
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { MissionCheckButton } from '@/features/dashboard/MissionCheckButton';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { readPrimitiveFiles } from '@/libs/workspace/reader';
import { agentSchema, missionSchema } from '@/models/Schema';
import { toPayload } from '@/services/ArtifactService';
import { listAutomations } from '@/services/AutomationService';
import { recordRef } from '@/services/chat/recordContext';
import { ensureSourceArtifact } from '@/services/workspace/WorkspaceSourceService';
import { isEntityStatus } from '@/types/Status';

/**
 * Mission detail — the charter, in full. A mission is an OBJECTIVE a team
 * owns: goal, success criteria, team, autonomy. The cadence lives on
 * whichever automations check it; the run history shows the checks.
 *
 * The mission IS its YAML file, and the file edits like an artifact
 * (`libs/workspace/source.ts`): the pane at the foot of the page is the
 * same `ArtifactPane` a document gets — Edit, ⌘S, a version for every save,
 * Restore, Share — and a save writes the file, then applies the workspace.
 * Highlight anything in the charter and the toolbar offers Ask and Change;
 * Change pre-types the instruction and the agent edits the file through
 * `write_mission`, which a person approves on a Review card with the diff.
 * @param props
 * @param props.params
 */
export default async function MissionDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
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

  const [automations, ownerAgent, specialists] = await Promise.all([
    listAutomations(orgId),
    db.select({ slug: agentSchema.slug, name: agentSchema.name, role: agentSchema.role }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, mission.agentSlug))).limit(1).then(r => r[0] ?? null),
    db.select({ slug: agentSchema.slug, name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.parentAgentSlug, mission.agentSlug))),
  ]);
  const checkers = automations.filter(a => a.doConfig.checkMission === slug && a.status === 'active');
  // The file as an artifact — created from disk on first visit when the
  // applier has not mirrored it yet. Null only when this host has no
  // workspace, in which case the raw file viewer stands in.
  const source = await ensureSourceArtifact(orgId, 'mission', slug).catch(() => null);
  const sourceFiles = source ? null : readPrimitiveFiles('mission', slug);
  const isLead = ownerAgent?.role === 'lead';
  const record = recordRef('mission', slug, mission.name);

  return (
    <div data-mission-page>
      <RecordContext record={record} />
      {/* Highlight anything in the charter: Ask, or Change (the agent edits the
          file through write_mission, reviewed). The source pane below has its
          own toolbar over the file itself. */}
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

      <div className="mb-6 grid gap-4 lg:grid-cols-2" data-mission-charter>
        <section className="rounded-md border border-border p-5">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <Target className="size-4 text-primary" />
            Goal
          </h2>
          <p className="text-sm leading-relaxed">{mission.goal}</p>
          {(mission.successCriteria ?? []).length > 0 && (
            <>
              <h3 className="mt-4 mb-1.5 text-xs font-medium text-muted-foreground">Success criteria</h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground/85">
                {(mission.successCriteria ?? []).map(c => <li key={c.slice(0, 40)}>{c}</li>)}
              </ul>
            </>
          )}
          {(mission.desiredArtifacts ?? []).length > 0 && (
            <>
              <h3 className="mt-4 mb-1.5 text-xs font-medium text-muted-foreground">Deliverables</h3>
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
              Agent
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/dashboard/agents/${mission.agentSlug}`} className="rounded-full border border-border px-2.5 py-1 font-medium hover:bg-muted">
                {ownerAgent?.name ?? mission.agentSlug}
                {' '}
                <span className="text-[12px] text-muted-foreground">{ownerAgent?.role ?? 'agent'}</span>
              </Link>
            </div>
            {isLead && specialists.length > 0 && (
              <>
                <h3 className="mt-4 mb-1.5 text-xs font-medium text-muted-foreground">Specialists it can hand off to</h3>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {specialists.map(s => (
                    <Link key={s.slug} href={`/dashboard/agents/${s.slug}`} className="rounded-full border border-border px-2.5 py-1 hover:bg-muted">
                      {s.name}
                    </Link>
                  ))}
                </div>
              </>
            )}
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

      {source && (
        <section className="mb-6" aria-label="Mission file">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <FileCode2 className="size-4 text-primary" />
            The file
            <span className="text-xs font-normal text-muted-foreground">
              missions/
              {slug}
              .yaml — edit here, or highlight and ask; every save is a version and a workspace apply
            </span>
          </h2>
          <div className="h-[70vh] min-h-[480px]" data-mission-source>
            <StandaloneArtifactView artifact={toPayload(source)} selfId={userId ?? null} conversationId={null} />
          </div>
        </section>
      )}

      {sourceFiles && (
        <PrimitiveFiles
          files={sourceFiles.files}
          editInGitPath={sourceFiles.editInGitPath}
        />
      )}
    </div>
  );
}
