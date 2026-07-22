'use client';

import { ArrowRight, Bookmark, Check, Loader2, SkipForward, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/**
 * Catch-up triage — the Slack-style "clear the queue" flow over pending
 * agent-suggested actions. One card at a time: Send · Save for later · Skip ·
 * Reject, with a progress bar and "Save all & close". Send/Reject decide the
 * item (execute / record); Save + Skip leave it PENDING and advance (Save = I'll
 * deal with it later; Skip = not now). Email drafts are editable inline before
 * sending — nothing goes out without an explicit Send.
 *
 * Mobile: bottom sheet. Desktop: centered panel.
 */

type ActionRun = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  invokedBy: string | null;
  proposal: { confidence?: number; rationale?: string } | null;
};

type EmailEdit = { to: string; subject: string; body: string };
type Outcome = 'sent' | 'saved' | 'skipped' | 'rejected';

export type ActionQueueTriageProps = {
  open: boolean;
  onClose: () => void;
  /** Called after the triage ends so the parent can refresh its queue view. */
  onDone?: () => void;
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

const isEmail = (p: ActionRun): boolean => p.actionId === 'gmail.send';
const isDraft = (p: ActionRun): boolean => p.input.draft === true;

export function ActionQueueTriage({ open, onClose, onDone }: ActionQueueTriageProps) {
  const [items, setItems] = useState<ActionRun[]>([]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [hint, setHint] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [edit, setEdit] = useState<EmailEdit | null>(null);
  const tally = useRef<Record<Outcome, number>>({ sent: 0, saved: 0, skipped: 0, rejected: 0 });

  useEffect(() => {
    if (!open) {
      return;
    }
    setIdx(0);
    setLoaded(false);
    tally.current = { sent: 0, saved: 0, skipped: 0, rejected: 0 };
    void (async () => {
      try {
        const p = await client.review.listPendingActions();
        setItems(p as ActionRun[]);
      } catch {
        setItems([]);
      }
      setLoaded(true);
    })();
  }, [open]);

  const current = items[idx];

  // Seed the editable fields when the card changes.
  useEffect(() => {
    setHint('');
    if (current && isEmail(current)) {
      setEdit({ to: String(current.input.to ?? ''), subject: String(current.input.subject ?? ''), body: String(current.input.body ?? '') });
    } else {
      setEdit(null);
    }
  }, [current]);

  const advance = useCallback(() => setIdx(i => i + 1), []);

  const decide = useCallback(async (outcome: Outcome) => {
    if (!current) {
      return;
    }
    tally.current[outcome] += 1;
    if (outcome === 'sent' || outcome === 'rejected') {
      setBusy(true);
      try {
        const editedInput = outcome === 'sent' && isEmail(current) && edit ? { ...current.input, ...edit } : undefined;
        await client.review.decideAction({ id: current.id, decision: outcome === 'sent' ? 'approve' : 'reject', ...(editedInput ? { editedInput } : {}) });
      } catch {
        /* leave it pending; operator can retry from the full queue */
      } finally {
        setBusy(false);
      }
    } else {
      // Save / Skip leave the item pending but are still TYPED signals.
      void client.review.recordSignal({ runId: current.id, signal: outcome === 'saved' ? 'save' : 'skip' }).catch(() => {});
    }
    advance();
  }, [current, edit, advance]);

  // Rewrite-with-AI: ask the model to redo the draft (optionally per a hint).
  // The rewrite itself is a tone signal, recorded server-side.
  const onRewrite = useCallback(async () => {
    if (!current || !isEmail(current)) {
      return;
    }
    setRewriting(true);
    try {
      const res = await client.review.rewriteDraft({ runId: current.id, hint: hint.trim() || undefined });
      setEdit(e => (e ? { ...e, body: res.body } : e));
      setHint('');
    } catch {
      /* keep the current draft */
    } finally {
      setRewriting(false);
    }
  }, [current, hint]);

  if (!open) {
    return null;
  }

  const total = items.length;
  const done = loaded && idx >= total;
  const t = tally.current;

  return (
    <>
      <button type="button" aria-label="Close triage" onClick={onClose} className="fixed inset-0 z-40 bg-black/50" />
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:inset-x-auto sm:top-1/2 sm:right-1/2 sm:bottom-auto sm:translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Catch up</div>
            <div className="text-sm font-medium">
              {done || total === 0 ? 'Queue' : `${idx + 1} of ${total}`}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </header>

        {total > 0 && !done && (
          <div className="h-1 w-full bg-muted">
            <div className="h-full bg-brand-amber transition-all" style={{ width: `${(idx / total) * 100}%` }} />
          </div>
        )}

        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4">
          {!loaded && <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}

          {loaded && total === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">Nothing in the queue — you're all caught up.</div>
          )}

          {done && total > 0 && (
            <div className="py-8 text-center">
              <div className="mb-2 text-base font-semibold">All caught up</div>
              <div className="text-sm text-muted-foreground">
                {t.sent} sent · {t.saved} saved · {t.skipped} skipped · {t.rejected} rejected
              </div>
            </div>
          )}

          {!done && current && (
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{current.actionId}</code>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${confidenceTone(current.proposal?.confidence)}`}>
                  {current.proposal?.confidence !== undefined ? `${Math.round(current.proposal.confidence * 100)}%` : 'unscored'}
                </span>
                {isDraft(current) && <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">dry run → Drafts</span>}
              </div>
              {current.proposal?.rationale && <p className="text-sm break-words text-foreground/85">{current.proposal.rationale}</p>}

              {isEmail(current) && edit
                ? (
                    <div className="space-y-2">
                      {(['to', 'subject'] as const).map(f => (
                        <label key={f} className="block">
                          <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{f}</span>
                          <input
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand-amber"
                            value={edit[f]}
                            onChange={ev => setEdit(e => (e ? { ...e, [f]: ev.target.value } : e))}
                            disabled={busy}
                          />
                        </label>
                      ))}
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Message</span>
                        <textarea
                          className="min-h-32 w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm leading-relaxed outline-none focus:border-brand-amber"
                          value={edit.body}
                          onChange={ev => setEdit(e => (e ? { ...e, body: ev.target.value } : e))}
                          disabled={busy || rewriting}
                        />
                      </label>
                      {/* Rewrite with AI — optional hint, then a rewrite pass. */}
                      <div className="flex items-center gap-2">
                        <input
                          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-brand-amber"
                          placeholder="Rewrite hint (optional) — e.g. shorter, warmer"
                          value={hint}
                          onChange={ev => setHint(ev.target.value)}
                          disabled={busy || rewriting}
                          onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void onRewrite(); } }}
                        />
                        <Button size="sm" variant="outline" onClick={() => void onRewrite()} disabled={busy || rewriting}>
                          {rewriting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                          Rewrite
                        </Button>
                      </div>
                    </div>
                  )
                : (
                    <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 text-[11px] break-words whitespace-pre-wrap">{JSON.stringify(current.input, null, 2)}</pre>
                  )}
            </div>
          )}
        </div>

        {/* Actions */}
        {!done && current && (
          <div className="border-t border-border p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button size="sm" variant="ghost" onClick={() => decide('skipped')} disabled={busy}>
                <SkipForward className="size-3.5" />
                Skip
              </Button>
              <Button size="sm" variant="outline" onClick={() => decide('saved')} disabled={busy}>
                <Bookmark className="size-3.5" />
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => decide('rejected')} disabled={busy}>
                <X className="size-3.5" />
                Reject
              </Button>
              <Button size="sm" onClick={() => decide('sent')} disabled={busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                {isEmail(current) ? (isDraft(current) ? 'Draft' : 'Send') : 'Approve'}
              </Button>
            </div>
            <button type="button" onClick={() => { onDone?.(); onClose(); }} className="mt-2 flex w-full items-center justify-center gap-1 py-1 text-xs text-muted-foreground transition hover:text-foreground">
              Save all &amp; close
              <ArrowRight className="size-3" />
            </button>
          </div>
        )}

        {done && (
          <div className="border-t border-border p-3">
            <Button size="sm" className="w-full" onClick={() => { onDone?.(); onClose(); }}>Done</Button>
          </div>
        )}
      </div>
    </>
  );
}
