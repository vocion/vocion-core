'use client';

import { Check, Loader2, ShieldCheck, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/**
 * Action proposals — the sweep's CRM updates awaiting a decision, each with
 * its confidence envelope (confidence · rationale · evidence). Approve
 * executes through the vaulted connector; reject records the reason. Every
 * decision trains the agents (learning rules). Below the queue: the
 * trust-ladder audit — proposals that executed automatically.
 */

type ActionRun = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  invokedBy: string | null;
  createdAt: string | Date;
  executedAt?: string | Date | null;
  proposal: { confidence?: number; rationale?: string; evidence?: string[]; autoApproved?: boolean; autoApprovedThreshold?: number } | null;
};

function confidenceTone(c?: number): string {
  if (c === undefined) {
    return 'bg-muted text-muted-foreground';
  }
  if (c >= 0.85) {
    return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  }
  if (c >= 0.7) {
    return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  }
  return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
}

export function ActionProposals() {
  const [pending, setPending] = useState<ActionRun[]>([]);
  const [auto, setAuto] = useState<ActionRun[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        client.review.listPendingActions(),
        client.review.listAutoExecuted(),
      ]);
      setPending(p as ActionRun[]);
      setAuto(a as ActionRun[]);
    } catch {
      /* surfaces as empty; the queue sections below render nothing */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    // False positive: every setState in refresh() runs after an await.

    void refresh();
  }, [refresh]);

  const onDecide = async (id: number, decision: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      await client.review.decideAction({ id, decision });
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (!loaded || (pending.length === 0 && auto.length === 0)) {
    return null;
  }

  return (
    <div className="mt-6 space-y-6">
      {pending.length > 0 && (
        <section className="rounded-md border border-border p-5">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
            <Zap className="size-4 text-primary" />
            Proposed CRM updates
            <span className="text-xs font-normal text-muted-foreground">
              {pending.length}
              {' '}
              awaiting your decision — approving executes through the connector; every decision trains the team
            </span>
          </h2>
          {pending.map(p => (
            <div key={p.id} className="flex flex-wrap items-start gap-3 border-b border-border py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{p.actionId}</code>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${confidenceTone(p.proposal?.confidence)}`}>
                    {p.proposal?.confidence !== undefined ? `${Math.round(p.proposal.confidence * 100)}% confidence` : 'unscored'}
                  </span>
                  {p.invokedBy && <span className="text-[11px] text-muted-foreground">{p.invokedBy}</span>}
                </div>
                {p.proposal?.rationale && (
                  <p className="mt-1 text-sm text-foreground/85">{p.proposal.rationale}</p>
                )}
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground">proposed change</summary>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px]">{JSON.stringify(p.input, null, 2)}</pre>
                </details>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => onDecide(p.id, 'approve')} disabled={busyId === p.id}>
                  {busyId === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => onDecide(p.id, 'reject')} disabled={busyId === p.id}>
                  <X className="size-3.5" />
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {auto.length > 0 && (
        <section className="rounded-md border border-border p-5">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="size-4 text-primary" />
            Executed automatically
            <span className="text-xs font-normal text-muted-foreground">
              trust-ladder audit — proposals that cleared an enabled rule's threshold
            </span>
          </h2>
          {auto.map(p => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-sm last:border-0">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{p.actionId}</code>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${confidenceTone(p.proposal?.confidence)}`}>
                {Math.round((p.proposal?.confidence ?? 0) * 100)}
                % ≥
                {Math.round((p.proposal?.autoApprovedThreshold ?? 0) * 100)}
                % rule
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.proposal?.rationale}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{p.status}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
