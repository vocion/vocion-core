'use client';

import { CheckCircle, Clock, GitBranch, RotateCw, Sparkles, XCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

type SkillRunRow = {
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

type WorkflowRunRow = {
  id: number;
  workflowId: number;
  status: string;
  currentStep: number | null;
  pauseReason: string | null;
  stepResults: Record<string, { status: string; output?: unknown; error?: string }>;
  error: string | null;
  contextSha: string | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
};

type Props = {
  initialSkillRuns: SkillRunRow[];
  initialWorkflowRuns: WorkflowRunRow[];
};

/**
 * Review Queue — combined list of pending skill runs and paused workflow runs
 * that need human attention. Uses oRPC mutations to approve / reject / resume /
 * cancel; refetches from server after each mutation via router.refresh().
 *
 * Intentionally server-data-driven: the server component hydrates the initial
 * list; this component only handles actions + refresh. No client-side polling
 * — the list refreshes on every mutation.
 * @param root0
 * @param root0.initialSkillRuns
 * @param root0.initialWorkflowRuns
 */
export function ReviewQueue({ initialSkillRuns, initialWorkflowRuns }: Props) {
  const [skillRuns, setSkillRuns] = useState(initialSkillRuns);
  const [workflowRuns, setWorkflowRuns] = useState(initialWorkflowRuns);
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (fn: () => Promise<void>) => {
    setActionError(null);
    startTransition(async () => {
      try {
        await fn();
        // Refresh both lists from server. Normalize skill runs (truncate output)
        // to match the server-page shape.
        const [sr, wr] = await Promise.all([
          client.review.listSkillRuns({ status: 'pending', limit: 50 }),
          client.review.listWorkflowRuns({ status: 'paused', limit: 50 }),
        ]);
        setSkillRuns(sr.map(normalizeSkillRun));
        setWorkflowRuns(wr as WorkflowRunRow[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setActionError(message);
      }
    });
  };

  function normalizeSkillRun(r: { id: number; skillId: number; status: string | null; input: unknown; output: string | null; contextSha: string | null; langfuseTraceId: string | null; createdBy: string | null; createdAt: Date | string; reviewedBy: string | null; reviewedAt: Date | string | null }): SkillRunRow {
    const MAX = 4000;
    return {
      id: r.id,
      skillId: r.skillId,
      status: r.status,
      input: r.input as Record<string, unknown> | null,
      output: r.output ? r.output.slice(0, MAX) : null,
      truncated: !!(r.output && r.output.length > MAX),
      contextSha: r.contextSha,
      langfuseTraceId: r.langfuseTraceId,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt,
    };
  }

  const approveSkill = (id: number) => runAction(async () => {
    await client.review.approveSkillRun({ id });
  });
  const rejectSkill = (id: number) => runAction(async () => {
    await client.review.rejectSkillRun({ id });
  });
  const resumeWorkflow = (id: number) => runAction(async () => {
    await client.review.resumeWorkflow({ id });
  });
  const cancelWorkflow = (id: number) => runAction(async () => {
    await client.review.cancelWorkflow({ id });
  });

  const totalPending = skillRuns.length + workflowRuns.length;

  if (totalPending === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        <CheckCircle className="mx-auto mb-2 size-8 opacity-50" />
        Nothing pending review — queue is empty.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          Action failed:
          {' '}
          {actionError}
        </div>
      )}
      {workflowRuns.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <GitBranch className="size-4" />
            <h2 className="text-lg font-semibold">Paused workflow runs</h2>
            <Badge variant="secondary">{workflowRuns.length}</Badge>
          </div>
          <div className="space-y-2">
            {workflowRuns.map(run => (
              <WorkflowRunCard
                key={`wf-${run.id}`}
                run={run}
                isOpen={openId === `wf-${run.id}`}
                onToggle={() => setOpenId(openId === `wf-${run.id}` ? null : `wf-${run.id}`)}
                onResume={() => resumeWorkflow(run.id)}
                onCancel={() => cancelWorkflow(run.id)}
                busy={pending}
              />
            ))}
          </div>
        </div>
      )}

      {skillRuns.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4" />
            <h2 className="text-lg font-semibold">Pending skill drafts</h2>
            <Badge variant="secondary">{skillRuns.length}</Badge>
          </div>
          <div className="space-y-2">
            {skillRuns.map(run => (
              <SkillRunCard
                key={`sk-${run.id}`}
                run={run}
                isOpen={openId === `sk-${run.id}`}
                onToggle={() => setOpenId(openId === `sk-${run.id}` ? null : `sk-${run.id}`)}
                onApprove={() => approveSkill(run.id)}
                onReject={() => rejectSkill(run.id)}
                busy={pending}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SkillRunCard({
  run,
  isOpen,
  onToggle,
  onApprove,
  onReject,
  busy,
}: {
  run: SkillRunRow;
  isOpen: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const created = typeof run.createdAt === 'string' ? new Date(run.createdAt) : run.createdAt;
  return (
    <div className="rounded-md border border-border bg-background">
      <button type="button" className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50" onClick={onToggle}>
        <Clock className="size-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-sm font-medium">
            Skill run #
            {run.id}
            {' '}
            <span className="font-normal text-muted-foreground">
              (skill id:
              {run.skillId}
              )
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {created.toLocaleString()}
            {run.createdBy && (
              <>
                {' '}
                · by
                {run.createdBy}
              </>
            )}
            {run.contextSha && (
              <>
                {' '}
                · ctx
                <code>{run.contextSha.slice(0, 12)}</code>
              </>
            )}
          </div>
        </div>
        <Badge variant="outline">pending</Badge>
      </button>

      {isOpen && (
        <div className="space-y-3 border-t border-border p-3">
          <RunDetail label="Input" value={run.input} />
          <RunDetail label="Output" value={run.output} truncated={run.truncated} />
          {run.langfuseTraceId && (
            <div className="text-xs text-muted-foreground">
              Langfuse trace:
              {' '}
              <code>{run.langfuseTraceId}</code>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={onApprove} disabled={busy}>
              <CheckCircle className="mr-1 size-4" />
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
              <XCircle className="mr-1 size-4" />
              Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowRunCard({
  run,
  isOpen,
  onToggle,
  onResume,
  onCancel,
  busy,
}: {
  run: WorkflowRunRow;
  isOpen: boolean;
  onToggle: () => void;
  onResume: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const created = typeof run.createdAt === 'string' ? new Date(run.createdAt) : run.createdAt;
  const awaitingStep = run.pauseReason?.replace(/^awaiting_approval:/, '');
  const awaitingResult = awaitingStep ? run.stepResults[awaitingStep] : undefined;

  return (
    <div className="rounded-md border border-border bg-background">
      <button type="button" className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50" onClick={onToggle}>
        <GitBranch className="size-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-sm font-medium">
            Workflow run #
            {run.id}
            {awaitingStep && (
              <>
                {' '}
                · step “
                {awaitingStep}
                ”
              </>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {created.toLocaleString()}
            {run.contextSha && (
              <>
                {' '}
                · ctx
                <code>{run.contextSha.slice(0, 12)}</code>
              </>
            )}
          </div>
        </div>
        <Badge variant="outline">paused</Badge>
      </button>

      {isOpen && (
        <div className="space-y-3 border-t border-border p-3">
          {(awaitingResult?.output as { prompt?: string } | undefined)?.prompt && (
            <div className="rounded-md bg-muted/50 p-2 text-xs">
              <strong>Review prompt: </strong>
              {(awaitingResult!.output as { prompt: string }).prompt}
            </div>
          )}
          <RunDetail label="Step results" value={run.stepResults} />
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={onResume} disabled={busy}>
              <RotateCw className="mr-1 size-4" />
              Approve + resume
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
              <XCircle className="mr-1 size-4" />
              Cancel run
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RunDetail({ label, value, truncated }: { label: string; value: unknown; truncated?: boolean }) {
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
        {truncated && <span className="ml-2 italic">(truncated — open the skill run for full text)</span>}
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">{content}</pre>
    </div>
  );
}
