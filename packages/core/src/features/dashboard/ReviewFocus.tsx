'use client';

import { ArrowRight, Bookmark, Check, Loader2, ShieldCheck, SkipForward, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/**
 * Review — FOCUS MODE. One primary flow: the queue presents ONE item at a
 * time as a full detail (rationale, confidence, editable draft, Rewrite),
 * decided with Send / Save-for-later / Skip / Reject, with an "Up next" rail
 * (desktop) instead of an enormous list. No popups, no modals — the page IS
 * the flow. Skip/Save leave the item pending and record typed signals;
 * Send/Reject decide it. gmail.send never auto-sends.
 */

type ActionRun = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  invokedBy: string | null;
  createdAt: string | Date;
  proposal: { confidence?: number; rationale?: string } | null;
};

type EmailEdit = { to: string; subject: string; body: string };

function tone(c?: number): string {
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

export function ReviewFocus() {
  const [items, setItems] = useState<ActionRun[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [hint, setHint] = useState('');
  const [edit, setEdit] = useState<EmailEdit | null>(null);
  const [decided, setDecided] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const p = await client.review.listPendingActions();
      setItems(p as ActionRun[]);
    } catch {
      setItems([]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Focus target = first non-skipped pending item; skipped ones fall to the back.
  const queue = [...items.filter(i => !skipped.has(i.id)), ...items.filter(i => skipped.has(i.id))];
  const current = queue[0];

  useEffect(() => {
    setHint('');
    if (current && isEmail(current)) {
      setEdit({ to: String(current.input.to ?? ''), subject: String(current.input.subject ?? ''), body: String(current.input.body ?? '') });
    } else {
      setEdit(null);
    }
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const signal = (runId: number, s: 'skip' | 'save') => {
    void client.review.recordSignal({ runId, signal: s }).catch(() => {});
  };

  const onSkip = () => {
    if (!current) {
      return;
    }
    signal(current.id, 'skip');
    setSkipped(prev => new Set([...prev, current.id]));
  };

  const onSave = () => {
    if (!current) {
      return;
    }
    signal(current.id, 'save');
    // Saved = stays pending in the queue for later; drop from this session's focus.
    setItems(prev => prev.filter(i => i.id !== current.id));
    setDecided(d => d + 1);
  };

  const onDecide = async (decision: 'approve' | 'reject') => {
    if (!current) {
      return;
    }
    setBusy(true);
    try {
      const editedInput = decision === 'approve' && isEmail(current) && edit ? { ...current.input, ...edit } : undefined;
      await client.review.decideAction({ id: current.id, decision, ...(editedInput ? { editedInput } : {}) });
      setItems(prev => prev.filter(i => i.id !== current.id));
      setDecided(d => d + 1);
    } finally {
      setBusy(false);
    }
  };

  const onRewrite = async () => {
    if (!current || !isEmail(current)) {
      return;
    }
    setRewriting(true);
    try {
      const res = await client.review.rewriteDraft({ runId: current.id, hint: hint.trim() || undefined });
      setEdit(e => (e ? { ...e, body: res.body } : e));
      setHint('');
    } catch {
      /* keep draft */
    } finally {
      setRewriting(false);
    }
  };

  if (!loaded) {
    return <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!current) {
    return (
      <div className="rounded-2xl border border-border px-6 py-12 text-center">
        <ShieldCheck className="mx-auto size-8 text-brand-amber-deep" aria-hidden />
        <div className="mt-2 text-base font-semibold">All caught up</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {decided > 0 ? `${decided} handled this session. ` : ''}
          New agent proposals land here for your decision.
        </p>
      </div>
    );
  }

  const pct = current.proposal?.confidence !== undefined ? Math.round(current.proposal.confidence * 100) : null;
  const fieldClass = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-brand-amber';

  return (
    <div className="flex gap-6" data-testid="review-focus">
      {/* THE item — one at a time */}
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Up now</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {queue.length}
            {' '}
            in queue
          </span>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{current.actionId}</code>
            {pct !== null && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone(current.proposal?.confidence)}`}>{pct}%</span>}
            {current.input.draft === true && <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">dry run → Drafts</span>}
            {current.invokedBy && <span className="text-[11px] text-muted-foreground">{current.invokedBy}</span>}
          </div>
          {current.proposal?.rationale && <p className="mt-2 text-sm break-words text-foreground/85">{current.proposal.rationale}</p>}

          {isEmail(current) && edit
            ? (
                <div className="mt-3 space-y-2">
                  {(['to', 'subject'] as const).map(f => (
                    <label key={f} className="block">
                      <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{f}</span>
                      <input className={fieldClass} value={edit[f]} onChange={ev => setEdit(e => (e ? { ...e, [f]: ev.target.value } : e))} disabled={busy || rewriting} />
                    </label>
                  ))}
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Message</span>
                    <textarea className={`${fieldClass} min-h-36 resize-y leading-relaxed`} value={edit.body} onChange={ev => setEdit(e => (e ? { ...e, body: ev.target.value } : e))} disabled={busy || rewriting} />
                  </label>
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
                <pre className="mt-3 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px] break-words whitespace-pre-wrap">{JSON.stringify(current.input, null, 2)}</pre>
              )}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Button size="sm" variant="ghost" onClick={onSkip} disabled={busy}>
              <SkipForward className="size-3.5" />
              Skip
            </Button>
            <Button size="sm" variant="outline" onClick={onSave} disabled={busy}>
              <Bookmark className="size-3.5" />
              Save for later
            </Button>
            <Button size="sm" variant="outline" onClick={() => void onDecide('reject')} disabled={busy}>
              <X className="size-3.5" />
              Reject
            </Button>
            <Button size="sm" onClick={() => void onDecide('approve')} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {isEmail(current) ? (current.input.draft === true ? 'Approve → draft' : 'Approve & send') : 'Approve'}
            </Button>
          </div>
          {isEmail(current) && <p className="mt-2 text-[11px] text-muted-foreground">Edit anything above — your version is exactly what goes out. Nothing sends without you.</p>}
        </div>
      </div>

      {/* Up-next rail (desktop) — list as NAVIGATION, not the surface */}
      {queue.length > 1 && (
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="mb-2 px-1 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Up next</div>
          <ul className="space-y-1.5">
            {queue.slice(1, 8).map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    // Jump = skip everything ahead of it in this session's order.
                    setSkipped(prev => new Set([...prev, ...queue.slice(0, queue.indexOf(item)).map(i => i.id)]));
                  }}
                  className="group flex w-full items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2 text-left text-xs transition hover:border-brand-amber/40"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {String(item.input.subject ?? item.actionId)}
                  </span>
                  <ArrowRight className="size-3 shrink-0 text-muted-foreground/50 transition group-hover:text-brand-amber-deep" aria-hidden />
                </button>
              </li>
            ))}
            {queue.length > 8 && <li className="px-2.5 text-[11px] text-muted-foreground/60">+{queue.length - 8} more</li>}
          </ul>
        </aside>
      )}
    </div>
  );
}
