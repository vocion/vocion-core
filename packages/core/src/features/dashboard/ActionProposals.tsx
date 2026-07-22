'use client';

import { Check, Layers, Loader2, ShieldCheck, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';
import { ActionQueueTriage } from './ActionQueueTriage';

/**
 * Action proposals — the sweep's CRM updates + outbound sends awaiting a
 * decision, each with its confidence envelope (confidence · rationale ·
 * evidence). Approve executes through the vaulted connector; reject records
 * the reason. Every decision trains the agents (learning rules).
 *
 * Email sends (gmail.send) are EDITABLE in place — the operator fixes the
 * to/subject/body before approving and the edited payload is what goes out
 * (edit-then-approve). Draft-mode sends land in Gmail Drafts (dry run).
 * Other action types keep the read-only JSON preview.
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

type EmailEdit = { to: string; subject: string; body: string };

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

const isEmail = (p: ActionRun): boolean => p.actionId === 'gmail.send';
const isDraftMode = (p: ActionRun): boolean => p.input.draft === true;

export function ActionProposals() {
  const [pending, setPending] = useState<ActionRun[]>([]);
  const [auto, setAuto] = useState<ActionRun[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  // Operator edits to email drafts, keyed by proposal id. Absent = untouched.
  const [edits, setEdits] = useState<Record<number, EmailEdit>>({});

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

  const editFor = (p: ActionRun): EmailEdit => edits[p.id] ?? {
    to: String(p.input.to ?? ''),
    subject: String(p.input.subject ?? ''),
    body: String(p.input.body ?? ''),
  };
  const patchEdit = (p: ActionRun, patch: Partial<EmailEdit>) =>
    setEdits(prev => ({ ...prev, [p.id]: { ...editFor(p), ...patch } }));

  const onDecide = async (p: ActionRun, decision: 'approve' | 'reject') => {
    setBusyId(p.id);
    try {
      const editedInput = decision === 'approve' && isEmail(p)
        ? { ...p.input, ...editFor(p) }
        : undefined;
      await client.review.decideAction({ id: p.id, decision, ...(editedInput ? { editedInput } : {}) });
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (!loaded || (pending.length === 0 && auto.length === 0)) {
    return null;
  }

  const fieldClass = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-brand-amber';

  return (
    <div className="mt-6 space-y-6">
      <ActionQueueTriage open={triageOpen} onClose={() => setTriageOpen(false)} onDone={refresh} />
      {pending.length > 0 && (
        <section className="rounded-md border border-border p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
              <Zap className="size-4 text-primary" />
              Proposed actions
              <span className="text-xs font-normal text-muted-foreground">
                {pending.length}
                {' '}
                awaiting you — edit anything before approving; nothing sends without your ok
              </span>
            </h2>
            {pending.length > 1 && (
              <Button size="sm" variant="outline" onClick={() => setTriageOpen(true)}>
                <Layers className="size-3.5" />
                Catch up (
                {pending.length}
                )
              </Button>
            )}
          </div>
          {pending.map((p) => {
            const email = isEmail(p);
            const draft = isDraftMode(p);
            const e = editFor(p);
            const busy = busyId === p.id;
            return (
              <div key={p.id} className="flex flex-col gap-3 border-b border-border py-4 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{p.actionId}</code>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${confidenceTone(p.proposal?.confidence)}`}>
                    {p.proposal?.confidence !== undefined ? `${Math.round(p.proposal.confidence * 100)}% confidence` : 'unscored'}
                  </span>
                  {draft && (
                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                      dry run → Gmail Drafts
                    </span>
                  )}
                  {p.invokedBy && <span className="text-[11px] text-muted-foreground">{p.invokedBy}</span>}
                </div>

                {p.proposal?.rationale && (
                  <p className="text-sm text-foreground/85">{p.proposal.rationale}</p>
                )}

                {email
                  ? (
                      <div className="space-y-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">To</span>
                          <input className={fieldClass} value={e.to} onChange={ev => patchEdit(p, { to: ev.target.value })} disabled={busy} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Subject</span>
                          <input className={fieldClass} value={e.subject} onChange={ev => patchEdit(p, { subject: ev.target.value })} disabled={busy} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Message</span>
                          <textarea className={`${fieldClass} min-h-40 resize-y leading-relaxed`} value={e.body} onChange={ev => patchEdit(p, { body: ev.target.value })} disabled={busy} />
                        </label>
                        <p className="text-[11px] text-muted-foreground">Edit before you send — your changes are exactly what goes out.</p>
                      </div>
                    )
                  : (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">proposed change</summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px]">{JSON.stringify(p.input, null, 2)}</pre>
                      </details>
                    )}

                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onDecide(p, 'approve')} disabled={busy}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    {email ? (draft ? 'Approve → draft' : 'Approve & send') : 'Approve'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onDecide(p, 'reject')} disabled={busy}>
                    <X className="size-3.5" />
                    Reject
                  </Button>
                </div>
              </div>
            );
          })}
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
