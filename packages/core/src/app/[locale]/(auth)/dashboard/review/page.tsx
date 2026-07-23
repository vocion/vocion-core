import { setRequestLocale } from 'next-intl/server';
import { ReviewFocus } from '@/features/dashboard/ReviewFocus';
import { ReviewQueue } from '@/features/dashboard/ReviewQueue';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { listSkillRuns } from '@/services/SkillService';
import { listWorkflowRuns } from '@/services/WorkflowService';

/**
 * Review — ONE primary flow: focus mode over the agent-proposed action queue
 * (one item at a time, decide and move on; up-next rail instead of a long
 * list; no popups). Skill drafts + paused workflows are internal mechanics,
 * not the operator's main job — they're demoted to a collapsed section below.
 */

type ConfidenceLevel = 'confident' | 'uncertain' | 'speculative';

function asConfidence(v: string | null): ConfidenceLevel | null {
  return (v === 'confident' || v === 'uncertain' || v === 'speculative') ? v : null;
}

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

  const [skillRunsRaw, workflowRuns] = await Promise.all([
    listSkillRuns({ orgId, status: 'pending', limit: 50 }),
    listWorkflowRuns(orgId, { status: 'paused', limit: 50 }),
  ]);
  const skillRuns = skillRunsRaw.map(r => ({
    id: r.id,
    skillId: r.skillId,
    status: r.status,
    input: r.input as Record<string, unknown> | null,
    output: r.output ? r.output.slice(0, 4000) : null,
    truncated: !!(r.output && r.output.length > 4000),
    workspaceSha: r.workspaceSha,
    langfuseTraceId: r.langfuseTraceId,
    confidence: asConfidence(r.confidence),
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
  }));
  const otherCount = skillRuns.length + workflowRuns.length;

  return (
    <>
      <TitleBar
        title="Review"
        description="One thing at a time — decide it and the next one loads. Nothing sends without you."
      />
      <ReviewFocus />

      {otherCount > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground transition hover:text-foreground">
            Other approvals (
            {otherCount}
            ) — skill drafts &amp; paused workflows
          </summary>
          <div className="mt-3">
            <ReviewQueue initialSkillRuns={skillRuns} initialWorkflowRuns={workflowRuns} />
          </div>
        </details>
      )}
    </>
  );
}
