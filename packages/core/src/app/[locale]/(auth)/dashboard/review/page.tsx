import { setRequestLocale } from 'next-intl/server';
import { ReviewFocus } from '@/features/dashboard/ReviewFocus';
import { ReviewQueue } from '@/features/dashboard/ReviewQueue';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { listWorkflowRuns } from '@/services/WorkflowService';

/**
 * Review — ONE primary flow: focus mode over the agent-proposed action queue
 * (one item at a time, decide and move on; up-next rail instead of a long
 * list; no popups). Paused workflows are internal mechanics, not the
 * operator's main job — they're demoted to a collapsed section below.
 */

export default async function ReviewPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <>
        <TitleBar title="Review" description="Agent-proposed actions that need your decision." />
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
          Sign in to an organization to see the review queue.
        </div>
      </>
    );
  }

  const workflowRuns = await listWorkflowRuns(orgId, { status: 'paused', limit: 50 });

  return (
    <>
      <TitleBar
        title="Review"
        description="One thing at a time — decide it and the next one loads. Nothing sends without you."
      />
      <ReviewFocus />

      {workflowRuns.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground transition hover:text-foreground">
            Other approvals (
            {workflowRuns.length}
            ) — paused workflows
          </summary>
          <div className="mt-3">
            <ReviewQueue initialWorkflowRuns={workflowRuns} />
          </div>
        </details>
      )}
    </>
  );
}
