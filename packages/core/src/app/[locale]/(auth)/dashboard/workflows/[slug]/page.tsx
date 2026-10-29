import type { StepperStep } from '@/components/ui/stepper';
import type { RepeatInnerWorkflowStep, WorkflowStep } from '@/libs/workspace/schemas';
import { Activity, ArrowLeft, Compass, PlayCircle } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Stepper } from '@/components/ui/stepper';
import { PrimitiveActivity } from '@/features/dashboard/PrimitiveActivity';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { getWorkflowActivity } from '@/libs/activity';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getWorkspaceDirtyState } from '@/libs/workspace/dirty';
import { readPrimitiveFiles } from '@/libs/workspace/reader';
import { getAgent } from '@/services/AgentService';
import { getWorkflow } from '@/services/WorkflowService';

export default async function WorkflowDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  if (!orgId) {
    return notFound();
  }
  const workflow = await getWorkflow(orgId, slug);
  if (!workflow) {
    return notFound();
  }

  const owner = workflow.agent ? await getAgent(orgId, workflow.agent) : null;
  const sourceFiles = readPrimitiveFiles('workflow', slug);
  const dirtyState = getWorkspaceDirtyState();
  const activity = await getWorkflowActivity(orgId, slug);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/workflows"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Workflows
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div>
              <div>{workflow.name}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <Badge variant={workflow.status === 'active' ? 'default' : 'outline'}>{workflow.status}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{workflow.slug}</span>
                <span className="text-xs text-muted-foreground">
                  v
                  {workflow.version}
                </span>
                {workflow.agent && (
                  <Link
                    href={`/dashboard/agents/${workflow.agent}`}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
                    title="The agent this workflow belongs to"
                  >
                    <Compass className="size-3" />
                    Owned by
                    {' '}
                    {owner?.name ?? workflow.agent}
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
        description={workflow.description}
      />

      <PrimitiveActivity kind="workflow" slug={slug} {...activity} />

      <div className="mb-6">
        <div className="mb-3 font-display text-sm font-semibold">Steps</div>
        <Stepper
          steps={workflow.steps.flatMap((step, i): StepperStep[] => {
            const key = `${step.name}-${i}`;
            const when = step.when ? ` · when ${step.when}` : '';
            if (step.type === 'repeat') {
              return [
                { key, type: 'repeat', title: step.label ?? step.name, subtitle: `until ${step.until} · at most ${step.max} rounds${step.onExhausted === 'fail' ? ', then fail' : ', then go on'}${when}` },
                ...step.steps.map((inner, j): StepperStep => ({ key: `${key}-${j}`, type: inner.type, nested: true, title: inner.label ?? inner.name, subtitle: stepSubtitle(inner) })),
              ];
            }
            return [{ key, type: step.type, title: step.label ?? step.name, subtitle: `${stepSubtitle(step)}${when}` }];
          })}
        />
      </div>

      <section className="mb-8 flex flex-wrap items-center gap-3">
        <Link
          href={`/dashboard/workflows/${slug}/run`}
          className={buttonVariants({ size: 'sm' })}
        >
          <PlayCircle className="mr-2 size-4" />
          Run workflow
        </Link>
        <Link
          href={`/dashboard/activity?kind=workflow&slug=${slug}`}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <Activity className="size-4" />
          Recent runs in Activity
          <span aria-hidden>→</span>
        </Link>
      </section>

      {sourceFiles && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Source files</h2>
          <PrimitiveFiles
            files={sourceFiles.files}
            editInGitPath={sourceFiles.editInGitPath}
            dirty={dirtyState.dirty}
            dirtyFiles={dirtyState.changedFiles}
          />
        </section>
      )}
    </>
  );
}

/**
 * A step's second line on the definition: who or what does it.
 * @param step - The step as authored.
 */
function stepSubtitle(step: Exclude<WorkflowStep, { type: 'repeat' }> | RepeatInnerWorkflowStep): string {
  switch (step.type) {
    case 'agent':
      return `${step.agent}${step.effort && step.effort !== 'auto' ? ` · ${step.effort}` : ''}${step.output ? ' · returns a typed result' : ''}`;
    case 'action':
      return `action: ${step.action}`;
    case 'sync':
      return `refresh ${step.sources.join(', ')}`;
    default:
      return step.prompt ?? 'A person decides';
  }
}
