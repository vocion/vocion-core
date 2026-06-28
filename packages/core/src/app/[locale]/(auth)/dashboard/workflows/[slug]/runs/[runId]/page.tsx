import { ArrowLeft, CheckCircle2, Circle, Loader2, OctagonAlert, ShieldCheck } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { resolveCard } from '@/libs/cards';
import { Link } from '@/libs/I18nNavigation';
import { getWorkflow, getWorkflowRun } from '@/services/WorkflowService';

type Props = {
  params: Promise<{ locale: string; slug: string; runId: string }>;
};

type StepResult = {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval';
  output?: unknown;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  skillRunId?: number;
};

const STATUS_META: Record<StepResult['status'], { label: string; icon: React.ReactNode; dot: string }> = {
  pending: { label: 'Pending', icon: <Circle className="size-4 text-muted-foreground" />, dot: 'bg-muted' },
  running: { label: 'Running', icon: <Loader2 className="size-4 animate-spin text-blue-500" />, dot: 'bg-blue-500/70' },
  completed: { label: 'Completed', icon: <CheckCircle2 className="size-4 text-emerald-500" />, dot: 'bg-emerald-500' },
  failed: { label: 'Failed', icon: <OctagonAlert className="size-4 text-red-500" />, dot: 'bg-red-500' },
  awaiting_approval: { label: 'Awaiting approval', icon: <ShieldCheck className="size-4 text-amber-500" />, dot: 'bg-amber-500' },
};

const RUN_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  running: 'default',
  paused: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
};

export default async function WorkflowRunDetailPage(props: Props) {
  const { locale, slug, runId } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }
  const runIdNum = Number.parseInt(runId, 10);
  if (!Number.isFinite(runIdNum)) {
    notFound();
  }

  const [run, workflow] = await Promise.all([
    getWorkflowRun(runIdNum, orgId),
    getWorkflow(orgId, slug),
  ]);
  if (!run || !workflow) {
    notFound();
  }

  const stepResults = (run.stepResults ?? {}) as Record<string, StepResult>;

  return (
    <>
      <div className="mb-4">
        <Link
          href={`/dashboard/workflows/${slug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to
          {' '}
          {workflow.name}
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <span>{workflow.name}</span>
            <span className="font-mono text-sm text-muted-foreground">
              run #
              {run.id}
            </span>
            <Badge variant={RUN_STATUS_VARIANT[run.status] ?? 'outline'}>{run.status}</Badge>
          </div>
        )}
        description={(
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>
              started
              {' '}
              {formatRelative(run.createdAt)}
            </span>
            {run.completedAt && (
              <>
                <span aria-hidden>·</span>
                <span>
                  completed
                  {' '}
                  {formatRelative(run.completedAt)}
                </span>
              </>
            )}
            {run.pauseReason && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono text-xs">{run.pauseReason}</span>
              </>
            )}
            {run.workspaceSha && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono text-xs">
                  context
                  {' '}
                  {run.workspaceSha.slice(0, 7)}
                </span>
              </>
            )}
          </div>
        )}
      />

      {run.error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-red-600 dark:text-red-400">
            <OctagonAlert className="size-4" />
            Run failed
          </div>
          <pre className="mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-red-600/90 dark:text-red-400/90">
            {run.error}
          </pre>
        </div>
      )}

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold">Steps</h2>
        <ol className="space-y-4">
          {workflow.steps.map((step) => {
            const result = stepResults[step.name];
            const status = (result?.status ?? 'pending');
            const meta = STATUS_META[status];
            const kindLabel = step.type === 'skill' && 'skill' in step
              ? `operation · ${step.skill}`
              : step.type === 'action' && 'action' in step
                ? `action · ${step.action}`
                : 'approval';
            const card = result?.output !== undefined
              ? resolveCard(result.output, { surface: 'workflow-run' })
              : null;
            return (
              <li key={step.name} className="rounded-xl border border-border bg-background">
                <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-3">
                    {meta.icon}
                    <div>
                      <div className="font-semibold">{step.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{kindLabel}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{meta.label}</span>
                    {card && (
                      <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground" title={card.fallbackReason ?? `Rendered via ${card.source}`}>
                        card ·
                        {' '}
                        {card.slug}
                      </span>
                    )}
                  </div>
                </header>
                <div className="px-4 py-4">
                  {result?.error && (
                    <pre className="mb-3 overflow-x-auto rounded border border-red-500/30 bg-red-500/5 p-3 font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">
                      {result.error}
                    </pre>
                  )}
                  {card
                    ? (
                        <card.renderer.Renderer data={card.data as never} surface="workflow-run" />
                      )
                    : (
                        <p className="text-sm text-muted-foreground italic">
                          {status === 'pending' && 'Not yet started.'}
                          {status === 'running' && 'Running…'}
                          {status === 'awaiting_approval' && 'Paused for human approval. Review the previous step\'s draft, then approve or reject in /dashboard/review.'}
                          {status === 'completed' && '(no output)'}
                        </p>
                      )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-display text-sm font-semibold">Run metadata</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Run ID</dt>
          <dd className="font-mono">{run.id}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{run.status}</dd>
          <dt className="text-muted-foreground">Current step</dt>
          <dd>{run.currentStep ?? '—'}</dd>
        </dl>
      </section>
    </>
  );
}

function formatRelative(d: Date | string | null): string {
  if (!d) {
    return '—';
  }
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString();
}
