'use client';

import { CheckCircle, GitBranch, RotateCw, XCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { client } from '@/libs/Orpc';

type WorkflowRunRow = {
  id: number;
  workflowId: number;
  status: string;
  currentStep: number | null;
  pauseReason: string | null;
  stepResults: Record<string, { status: string; output?: unknown; error?: string }>;
  error: string | null;
  workspaceSha: string | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
};

type Props = {
  initialWorkflowRuns: WorkflowRunRow[];
};

/**
 * Review Queue — paused workflow runs that need human attention. Uses
 * oRPC mutations to resume / cancel; refetches from server after each
 * mutation.
 *
 * Intentionally server-data-driven: the server component hydrates the
 * initial list; this component only handles actions + refresh. No
 * client-side polling — the list refreshes on every mutation.
 * @param root0
 * @param root0.initialWorkflowRuns
 */
export function ReviewQueue({ initialWorkflowRuns }: Props) {
  const [workflowRuns, setWorkflowRuns] = useState(initialWorkflowRuns);
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (fn: () => Promise<void>) => {
    setActionError(null);
    startTransition(async () => {
      try {
        await fn();
        const wr = await client.review.listWorkflowRuns({ status: 'paused', limit: 50 });
        setWorkflowRuns(wr as WorkflowRunRow[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setActionError(message);
      }
    });
  };

  const resumeWorkflow = (id: number, input?: string) => runAction(async () => {
    await client.review.resumeWorkflow(input !== undefined ? { id, input } : { id });
  });
  const cancelWorkflow = (id: number) => runAction(async () => {
    await client.review.cancelWorkflow({ id });
  });

  const totalPending = workflowRuns.length;

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
                onResume={input => resumeWorkflow(run.id, input)}
                onCancel={() => cancelWorkflow(run.id)}
                busy={pending}
              />
            ))}
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
  onResume: (input?: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const created = typeof run.createdAt === 'string' ? new Date(run.createdAt) : run.createdAt;
  // `awaiting_approval:<step>` = approve gate; `awaiting_input:<step>` = ask
  // step — the run resumes only once a human supplies text.
  const awaitingInput = !!run.pauseReason?.startsWith('awaiting_input:');
  const awaitingStep = run.pauseReason?.replace(/^awaiting_(?:approval|input):/, '');
  const awaitingResult = awaitingStep ? run.stepResults[awaitingStep] : undefined;
  const [askInput, setAskInput] = useState('');

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
            {run.workspaceSha && (
              <>
                {' '}
                · ctx
                <code>{run.workspaceSha.slice(0, 12)}</code>
              </>
            )}
          </div>
        </div>
        <StatusPill status="paused" />
      </button>

      {isOpen && (
        <div className="space-y-3 border-t border-border p-3">
          {(awaitingResult?.output as { prompt?: string } | undefined)?.prompt && (
            <div className="rounded-md bg-muted/50 p-2 text-xs">
              <strong>{awaitingInput ? 'Input requested: ' : 'Review prompt: '}</strong>
              {(awaitingResult!.output as { prompt: string }).prompt}
            </div>
          )}
          {awaitingInput && (
            <textarea
              value={askInput}
              onChange={e => setAskInput(e.target.value)}
              rows={6}
              placeholder="Paste the requested text here…"
              className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs outline-none focus:border-primary/50"
            />
          )}
          <RunDetail label="Step results" value={run.stepResults} />
          <div className="flex gap-2 pt-2">
            {awaitingInput
              ? (
                  <Button size="sm" onClick={() => onResume(askInput)} disabled={busy || askInput.trim() === ''}>
                    <RotateCw className="mr-1 size-4" />
                    Submit & resume
                  </Button>
                )
              : (
                  <Button size="sm" onClick={() => onResume()} disabled={busy}>
                    <RotateCw className="mr-1 size-4" />
                    Approve + resume
                  </Button>
                )}
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
        {truncated && <span className="ml-2 italic">(truncated)</span>}
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">{content}</pre>
    </div>
  );
}
