import type { StepResult, StepStatus } from '@/libs/workflows/stepResult';
import type { RepeatInnerWorkflowStep, WorkflowStep } from '@/libs/workspace/schemas';
import { ArrowLeft, CheckCircle2, Circle, Loader2, OctagonAlert, ShieldCheck, SkipForward } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { FactList } from '@/components/patterns';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { resolveCard } from '@/libs/cards';
import { Link } from '@/libs/I18nNavigation';
import { modelName } from '@/libs/llm/modelPrefs';
import { getWorkflow, getWorkflowRun } from '@/services/WorkflowService';

type Props = {
  params: Promise<{ locale: string; slug: string; runId: string }>;
};

const STATUS_META: Record<StepStatus, { label: string; icon: React.ReactNode }> = {
  pending: { label: 'Pending', icon: <Circle className="size-4 text-muted-foreground" /> },
  running: { label: 'Running', icon: <Loader2 className="size-4 animate-spin text-muted-foreground" /> },
  completed: { label: 'Completed', icon: <CheckCircle2 className="size-4 text-pass" /> },
  failed: { label: 'Failed', icon: <OctagonAlert className="size-4 text-fail" /> },
  awaiting_approval: { label: 'Waiting on a person', icon: <ShieldCheck className="size-4 text-waiting" /> },
  skipped: { label: 'Skipped', icon: <SkipForward className="size-4 text-muted-foreground" /> },
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
            <span>{run.runLabel ?? workflow.name}</span>
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
        <Notice tone="fail" className="mb-6" title="Run failed">
          <pre className="mt-1 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-fail">
            {run.error}
          </pre>
        </Notice>
      )}

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold">Steps</h2>
        <ol className="space-y-4">
          {workflow.steps.map(step => (
            <StepCard key={step.name} step={step} result={stepResults[step.name]}>
              {step.type === 'repeat' && (
                <ol className="mt-3 space-y-3 border-l border-border pl-4">
                  {step.steps.map(inner => (
                    <StepCard key={inner.name} step={inner} result={stepResults[inner.name]} />
                  ))}
                </ol>
              )}
            </StepCard>
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-display text-sm font-semibold">Run metadata</h2>
        <FactList
          facts={[
            { label: 'Run ID', value: <span className="font-mono">{run.id}</span> },
            { label: 'Status', value: run.status },
            { label: 'Current step', value: run.currentStep ?? '—' },
          ]}
        />
      </section>
    </>
  );
}

/**
 * What kind of step this is, in a few words: who does it, and how.
 * @param step - The step as authored.
 */
function kindLine(step: WorkflowStep | RepeatInnerWorkflowStep): string {
  switch (step.type) {
    case 'agent':
      return `agent · ${step.agent}${step.effort && step.effort !== 'auto' ? ` · ${step.effort}` : ''}`;
    case 'repeat':
      return `repeat until ${step.until} · at most ${step.max} ${step.max === 1 ? 'round' : 'rounds'}`;
    case 'action':
      return `action · ${step.action}`;
    case 'sync':
      return `sync · ${step.sources.join(', ')}`;
    case 'ask':
      return 'a person answers';
    default:
      return 'a person approves';
  }
}

/**
 * Dollars from micro-cents (a millionth of a cent).
 * @param microCents - The cost.
 */
function dollars(microCents: number): string {
  const d = microCents / 100_000_000;
  return d < 0.01 ? '<$0.01' : `$${d.toFixed(2)}`;
}

/**
 * One step of the run: its label, what kind of step it is, how it went, and
 * what it produced — with an agent step's model, effort, cost and tries.
 * @param props - The step and its result.
 * @param props.step - The step as authored.
 * @param props.result - What the run recorded for it.
 * @param props.children - A repeat group's own steps.
 */
function StepCard({ step, result, children }: { step: WorkflowStep | RepeatInnerWorkflowStep; result?: StepResult; children?: React.ReactNode }) {
  const status = result?.status ?? 'pending';
  const meta = STATUS_META[status];
  const card = result?.output !== undefined && step.type !== 'repeat'
    ? resolveCard(result.output, { surface: 'workflow-run' })
    : null;
  const agent = result?.agent;
  const facts = [
    agent?.model ? modelName(agent.model) : null,
    agent?.effort ? agent.effort[0]!.toUpperCase() + agent.effort.slice(1) : null,
    typeof agent?.microCents === 'number' ? dollars(agent.microCents) : null,
    agent && agent.attempts.length > 1 ? `${agent.attempts.length} tries at the result` : null,
    result?.attempt && result.attempt > 1 ? `started ${result.attempt} times (a restart interrupted it)` : null,
    result?.previous?.length ? `${result.previous.length} earlier ${result.previous.length === 1 ? 'round' : 'rounds'}` : null,
    step.when ? `when ${step.when}` : null,
  ].filter(Boolean);
  return (
    <li className="rounded-xl border border-border bg-background">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-3">
          {meta.icon}
          <div>
            <div className="font-semibold">{result?.label ?? step.label ?? step.name}</div>
            <div className="font-mono text-xs text-muted-foreground">{kindLine(step)}</div>
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
        {facts.length > 0 && <p className="mb-3 text-xs text-muted-foreground">{facts.join(' · ')}</p>}
        {result?.error && (
          <pre className="mb-3 overflow-x-auto rounded bg-fail-soft p-3 font-mono text-xs whitespace-pre-wrap text-fail">
            {result.error}
          </pre>
        )}
        {agent?.attempts.filter(a => a.problem).map(a => (
          <p key={a.at} className="mb-2 text-xs text-muted-foreground">
            A try did not match the result's shape:
            {' '}
            {a.problem}
          </p>
        ))}
        {step.type === 'repeat'
          ? (result?.output !== undefined && (
              <p className="text-sm text-muted-foreground">
                {(result.output as { satisfied?: boolean }).satisfied ? 'The condition held; the group stopped.' : 'Every round ran and the condition never held.'}
              </p>
            ))
          : card
            ? (
                <card.renderer.Renderer data={card.data as never} surface="workflow-run" />
              )
            : (
                <p className="text-sm text-muted-foreground italic">
                  {status === 'pending' && 'Not yet started.'}
                  {status === 'running' && 'Running…'}
                  {status === 'awaiting_approval' && 'Waiting on a person: the Decision is on Needs you.'}
                  {status === 'skipped' && `Skipped: ${result?.skippedBecause ?? 'its condition was false'}.`}
                  {status === 'completed' && '(no output)'}
                </p>
              )}
        {children}
      </div>
    </li>
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
