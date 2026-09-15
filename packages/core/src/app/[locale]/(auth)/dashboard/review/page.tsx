import { setRequestLocale } from 'next-intl/server';
import { ReviewFocus } from '@/features/dashboard/ReviewFocus';
import { ReviewQueue } from '@/features/dashboard/ReviewQueue';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { listWorkflowRuns } from '@/services/WorkflowService';

/**
 * Review — ONE primary flow: focus mode over the agent-proposed action queue
 * (one item at a time, decide and move on; a one-line "Next" instead of a
 * rail; no popups). The page header (breadcrumb, item title, meta row) is
 * rendered by ReviewFocus, since it names the current item. Paused workflows
 * are internal mechanics, not the operator's main job — they're demoted to a
 * collapsed section below.
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
