import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { MissionRunActions } from '@/features/dashboard/MissionRunActions';
import { MissionRunPlan, MissionRunStopReason } from '@/features/dashboard/MissionRunPlan';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { artifactHref } from '@/libs/tools/artifacts/url';
import { recordRef } from '@/services/chat/recordContext';
import { getMissionRun } from '@/services/MissionService';

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-background p-5">
      <h2 className="mb-3 text-xs font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default async function MissionRunPage(props: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const run = orgId ? await getMissionRun(Number(id), orgId) : null;
  if (!run) {
    notFound();
  }

  const tasks = run.plan?.tasks ?? [];
  const artifacts = run.artifacts ?? [];
  const team = run.team;

  return (
    <>
      <RecordContext record={recordRef('mission_run', run.id, run.title)} />
      <TitleBar
        title={run.title}
        description={`Mission · ${run.status.replace('_', ' ')}`}
      />

      <div className="mb-5">
        <MissionRunActions runId={run.id} status={run.status} />
      </div>

      <MissionRunStopReason status={run.status} error={run.error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Brief">
          <p className="text-sm">{run.brief}</p>
          {run.goal && (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Goal:</span>
              {' '}
              {run.goal}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Autonomy level
            {(run.autonomyPolicy as { level?: number } | null)?.level ?? 1}
          </p>
        </Panel>

        <Panel title="Team">
          <ul className="flex flex-col gap-1.5 text-sm">
            <li>
              <span className="font-medium">{team.lead}</span>
              {' '}
              <span className="text-xs text-muted-foreground">· lead</span>
            </li>
            {team.members.map(m => <li key={m}>{m}</li>)}
          </ul>
        </Panel>

        <Panel title="Plan">
          <MissionRunPlan tasks={tasks} runStatus={run.status} />
        </Panel>

        <Panel title="Artifacts">
          {artifacts.length === 0
            ? <p className="text-sm text-muted-foreground">No artifacts yet.</p>
            : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {artifacts.map((a, i) => (
                    <li key={i}>
                      <a href={artifactHref(a.url)} className="text-primary hover:underline" target="_blank" rel="noreferrer">
                        {a.title ?? a.url}
                      </a>
                      <span className="ml-2 text-xs text-muted-foreground">{a.kind}</span>
                    </li>
                  ))}
                </ul>
              )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Coaching">
          <p className="text-sm text-muted-foreground">
            Approve drafts, give 👍/👎 feedback (becomes scoped learnings), and promote repeatable
            missions into reusable workflows. Use the actions above.
          </p>
        </Panel>
      </div>
    </>
  );
}
