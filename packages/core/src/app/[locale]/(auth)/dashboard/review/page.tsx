import { auth } from '@clerk/nextjs/server';
import { setRequestLocale } from 'next-intl/server';
import { ReviewQueue } from '@/features/dashboard/ReviewQueue';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { listSkillRuns } from '@/services/SkillService';
import { listWorkflowRuns } from '@/services/WorkflowService';

type SkillRunSummary = {
  id: number;
  skillId: number;
  status: string | null;
  input: Record<string, unknown> | null;
  output: string | null;
  truncated: boolean;
  contextSha: string | null;
  langfuseTraceId: string | null;
  createdBy: string | null;
  createdAt: Date | string;
  reviewedBy: string | null;
  reviewedAt: Date | string | null;
};

export default async function ReviewPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <div className="p-8">
        <TitleBar title="Review Queue" description="Pending drafts and paused workflows that need a decision." />
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
          Sign in to an organization to see the review queue.
        </div>
      </div>
    );
  }

  const [skillRunsRaw, workflowRuns] = await Promise.all([
    listSkillRuns({ orgId, status: 'pending', limit: 50 }),
    listWorkflowRuns(orgId, { status: 'paused', limit: 50 }),
  ]);

  const skillRuns: SkillRunSummary[] = skillRunsRaw.map(r => ({
    id: r.id,
    skillId: r.skillId,
    status: r.status,
    input: r.input as Record<string, unknown> | null,
    output: r.output ? r.output.slice(0, 4000) : null,
    truncated: !!(r.output && r.output.length > 4000),
    contextSha: r.contextSha,
    langfuseTraceId: r.langfuseTraceId,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
  }));

  return (
    <div className="p-6">
      <TitleBar
        title="Review Queue"
        description={`${skillRuns.length + workflowRuns.length} items need attention — pending skill drafts and paused workflow runs.`}
      />
      <ReviewQueue initialSkillRuns={skillRuns} initialWorkflowRuns={workflowRuns} />
    </div>
  );
}
