import { auth } from '@clerk/nextjs/server';
import { ArrowLeft, GitBranch } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { PrimitiveActivity } from '@/features/dashboard/PrimitiveActivity';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { getWorkflowActivity } from '@/libs/activity';
import { getContextDirtyState } from '@/libs/context/dirty';
import { readPrimitiveFiles } from '@/libs/context/reader';
import { Link } from '@/libs/I18nNavigation';
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

  const sourceFiles = readPrimitiveFiles('workflow', slug);
  const dirtyState = getContextDirtyState();
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

      <div className="mb-6 rounded-lg border border-border bg-background p-4">
        <div className="mb-3 text-sm font-semibold">Steps</div>
        <ol className="space-y-2 text-sm">
          {workflow.steps.map((step, i) => (
            <li key={`${step.name}-${i}`} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">{i + 1}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{step.name}</span>
                  <Badge variant="outline" className="text-[10px]">{step.type}</Badge>
                </div>
                {step.type === 'skill' && 'skill' in step && (
                  <div className="font-mono text-[11px] text-muted-foreground">
                    skill:
                    {' '}
                    {step.skill}
                  </div>
                )}
                {step.type === 'action' && 'action' in step && (
                  <div className="font-mono text-[11px] text-muted-foreground">
                    action:
                    {' '}
                    {step.action}
                  </div>
                )}
                {step.type === 'approve' && 'prompt' in step && step.prompt && (
                  <div className="text-[11px] text-muted-foreground">{step.prompt}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

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
