import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { MissionRunActions } from '@/features/dashboard/MissionRunActions';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { getMissionRun } from '@/services/MissionService';

const TASK_STATUS_TONE: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  running: 'text-primary',
  awaiting_approval: 'text-amber-600 dark:text-amber-400',
  failed: 'text-destructive',
  pending: 'text-muted-foreground',
  skipped: 'text-muted-foreground',
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-background p-5">
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
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
      <TitleBar title={run.title} description={`Mission · ${run.status.replace('_', ' ')}`} />

      <div className="mb-5">
        <MissionRunActions runId={run.id} status={run.status} />
      </div>

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
          {tasks.length === 0
            ? <p className="text-sm text-muted-foreground">Planning…</p>
            : (
                <ol className="flex flex-col gap-2">
                  {tasks.map((t, i) => (
                    <li key={t.id} className="flex items-start gap-3 text-sm">
                      <span className="mt-0.5 text-xs text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block">{t.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t.ownerAgentSlug}
                          {' '}
                          ·
                          {' '}
                          {t.type}
                        </span>
                      </span>
                      <span className={`text-[11px] ${TASK_STATUS_TONE[t.status] ?? 'text-muted-foreground'}`}>{t.status.replace('_', ' ')}</span>
                    </li>
                  ))}
                </ol>
              )}
        </Panel>

        <Panel title="Artifacts">
          {artifacts.length === 0
            ? <p className="text-sm text-muted-foreground">No artifacts yet.</p>
            : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {artifacts.map((a, i) => (
                    <li key={i}>
                      <a href={a.url} className="text-primary hover:underline" target="_blank" rel="noreferrer">
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
          {run.error && <p className="mt-2 text-sm text-destructive">{run.error}</p>}
        </Panel>
      </div>
    </>
  );
}
