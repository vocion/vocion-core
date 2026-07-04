import type { StepperStep } from '@/components/ui/stepper';
import { ArrowLeft, ArrowRight, GitBranch, PlayCircle } from 'lucide-react';
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
import { getWorkflow, listWorkflowRuns } from '@/services/WorkflowService';

const RUN_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  running: 'default',
  paused: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
};

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

  const sourceFiles = readPrimitiveFiles('workflow', slug);
  const dirtyState = getWorkspaceDirtyState();
  const activity = await getWorkflowActivity(orgId, slug);
  const recentRuns = await listWorkflowRuns(orgId, { workflowSlug: slug, limit: 10 });

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
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GitBranch className="size-5" />
            </div>
            <div>
              <div>{workflow.name}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <Badge variant={workflow.status === 'active' ? 'default' : 'outline'}>{workflow.status}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{workflow.slug}</span>
                <span className="text-xs text-muted-foreground">
                  v
                  {workflow.version}
                </span>
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
          steps={workflow.steps.map((step, i): StepperStep => {
            const key = `${step.name}-${i}`;
            if (step.type === 'skill' && 'skill' in step) {
              return { key, type: 'skill', title: step.name, subtitle: `skill: ${step.skill}` };
            }
            if (step.type === 'action' && 'action' in step) {
              return { key, type: 'action', title: step.name, subtitle: `action: ${step.action}` };
            }
            // Final branch: 'approve' type (narrowed by exhaustion of the
            // other two). 'prompt' check is defensive — older context rows
            // might lack it.
            const name = (step as { name: string }).name;
            const prompt = (step as { prompt?: string }).prompt;
            return { key, type: 'approve', title: name, subtitle: prompt ?? 'Human approval required' };
          })}
        />
      </div>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold">Recent runs</h2>
          <Link
            href={`/dashboard/workflows/${slug}/run`}
            className={buttonVariants({ size: 'sm' })}
          >
            <PlayCircle className="mr-2 size-4" />
            Run workflow
          </Link>
        </div>
        {recentRuns.length === 0
          ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                No runs yet. Click
                {' '}
                <strong className="font-semibold text-foreground">Run workflow</strong>
                {' '}
                above to start one — or seed sample runs with
                {' '}
                <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">node scripts/seed-tickets.ts</code>
                {' '}
                in the demos repo.
              </div>
            )
          : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-background">
                {recentRuns.map(run => (
                  <li key={run.id}>
                    <Link
                      href={`/dashboard/workflows/${slug}/runs/${run.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-muted-foreground">
                          #
                          {run.id}
                        </span>
                        <Badge variant={RUN_STATUS_VARIANT[run.status] ?? 'outline'}>{run.status}</Badge>
                        <span className="text-sm text-muted-foreground">
                          {new Date(run.createdAt).toLocaleString()}
                        </span>
                        {run.pauseReason && (
                          <span className="font-mono text-xs text-amber-600 dark:text-amber-400">
                            {run.pauseReason}
                          </span>
                        )}
                      </div>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
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
