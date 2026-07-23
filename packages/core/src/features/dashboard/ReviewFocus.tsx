'use client';

import { ArrowLeft, ArrowRight, Bookmark, Check, Loader2, Mail, RefreshCw, ShieldCheck, SkipForward, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/**
 * Review — FOCUS MODE with a human header. Every item leads with WHAT is
 * being approved in plain language (the action, the system it touches, the
 * concrete changes) — the raw payload is a drill, never the surface. Every
 * item is steerable (tell the agent what to change → rewrite) and editable
 * in place; Back returns to the previous item; the Up-next rail jumps
 * anywhere. No popups. gmail.send never auto-sends.
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

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * The human answer to "what am I approving?" — action verb + target system +
 * object, derived from the registered action id and its input.
 */
function describeAction(p: ActionRun): { title: string; system: string; isEmail: boolean } {
  const input = p.input;
  if (p.actionId === 'gmail.send') {
    const draft = input.draft === true;
    return { title: `${draft ? 'Draft email' : 'SEND email'} → ${str(input.to) || 'recipient'}`, system: 'Gmail', isEmail: true };
  }
  if (p.actionId.startsWith('hubspot.')) {
    const objectType = str(input.objectType) || 'record';
    return { title: `Update HubSpot ${objectType.replace(/s$/, '')} record`, system: 'HubSpot CRM', isEmail: false };
  }
  return { title: p.actionId, system: p.actionId.split('.')[0] ?? 'system', isEmail: false };
}

export function ReviewFocus() {
  const [items, setItems] = useState<ActionRun[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [pinnedId, setPinnedId] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steering, setSteering] = useState(false);
  const [steer, setSteer] = useState('');
  const [edited, setEdited] = useState<Record<string, string>>({});
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

  const queue = [...items.filter(i => !skipped.has(i.id)), ...items.filter(i => skipped.has(i.id))];
  const current = (pinnedId != null && items.find(i => i.id === pinnedId)) || queue[0];
  const desc = current ? describeAction(current) : null;

  // Editable working copy of the item's human fields.
  useEffect(() => {
    setSteer('');
    if (!current) {
      setEdited({});
      return;
    }
    if (describeAction(current).isEmail) {
      setEdited({ to: str(current.input.to), subject: str(current.input.subject), body: str(current.input.body) });
    } else {
      const props = (current.input.properties ?? {}) as Record<string, unknown>;
      setEdited(Object.fromEntries(Object.entries(props).map(([k, v]) => [k, str(v)])));
    }
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const signal = (runId: number, s: 'skip' | 'save') => {
    void client.review.recordSignal({ runId, signal: s }).catch(() => {});
  };

  const goTo = (id: number) => {
    if (current) {
      setHistory(h => [...h, current.id]);
    }
    setPinnedId(id);
  };

  const onBack = () => {
    const prev = history[history.length - 1];
    if (prev === undefined) {
      return;
    }
    setHistory(h => h.slice(0, -1));
    setSkipped(s => {
      const n = new Set(s);
      n.delete(prev);
      return n;
    });
    setPinnedId(prev);
  };

  const onSkip = () => {
    if (!current) {
      return;
    }
    signal(current.id, 'skip');
    setHistory(h => [...h, current.id]);
    setSkipped(prev => new Set([...prev, current.id]));
    setPinnedId(null);
  };

  const onSave = () => {
    if (!current) {
      return;
    }
    signal(current.id, 'save');
    setHistory(h => [...h, current.id]);
    setItems(prev => prev.filter(i => i.id !== current.id));
    setPinnedId(null);
    setDecided(d => d + 1);
  };

  const buildEditedInput = (): Record<string, unknown> | undefined => {
    if (!current) {
      return undefined;
    }
    if (desc?.isEmail) {
      return { ...current.input, ...edited };
    }
    if (current.input.properties) {
      return { ...current.input, properties: { ...(current.input.properties as Record<string, unknown>), ...edited } };
    }
    return undefined;
  };

  const onDecide = async (decision: 'approve' | 'reject') => {
    if (!current) {
      return;
    }
    setBusy(true);
    try {
      const editedInput = decision === 'approve' ? buildEditedInput() : undefined;
      await client.review.decideAction({ id: current.id, decision, ...(editedInput ? { editedInput } : {}) });
      setItems(prev => prev.filter(i => i.id !== current.id));
      setPinnedId(null);
      setDecided(d => d + 1);
    } finally {
      setBusy(false);
    }
  };

  const onSteer = async () => {
    if (!current) {
      return;
    }
    setSteering(true);
    try {
      const res = await client.review.rewriteDraft({ runId: current.id, hint: steer.trim() || undefined });
      // The rewrite lands in the long-text field (body or notes).
      setEdited(e => ('body' in e ? { ...e, body: res.body } : { ...e, notes: res.body }));
      setSteer('');
    } catch {
      /* keep current text */
    } finally {
      setSteering(false);
    }
  };

  if (!loaded) {
    return <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!current || !desc) {
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
  const longField = desc.isEmail ? 'body' : 'notes';

  return (
    <div className="flex gap-6" data-testid="review-focus">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center justify-between px-1">
          <button
            type="button"
            onClick={onBack}
            disabled={history.length === 0}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition enabled:hover:text-foreground disabled:opacity-40"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </button>
          <span className="font-mono text-[11px] text-muted-foreground">
            {queue.length}
            {' '}
            in queue
          </span>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          {/* WHAT am I approving — plain language, system badge, then why. */}
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-amber-tint text-brand-amber-deep">
              {desc.isEmail ? <Mail className="size-4" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-base leading-snug font-semibold break-words">{desc.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">{desc.system}</span>
                {pct !== null && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone(current.proposal?.confidence)}`}>{pct}%</span>}
                {current.input.draft === true && <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">dry run → Drafts</span>}
                {current.invokedBy && <span className="text-[11px] text-muted-foreground">{current.invokedBy.replace('agent:', 'proposed by ')}</span>}
              </div>
            </div>
          </div>
          {current.proposal?.rationale && <p className="mt-3 text-sm break-words text-foreground/85">{current.proposal.rationale}</p>}

          {/* The concrete changes — every field editable; your version is what runs. */}
          <div className="mt-4 space-y-2">
            {Object.entries(edited).map(([k, v]) => (
              k === longField
                ? (
                    <label key={k} className="block">
                      <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{k}</span>
                      <textarea className={`${fieldClass} min-h-32 resize-y leading-relaxed`} value={v} onChange={ev => setEdited(e => ({ ...e, [k]: ev.target.value }))} disabled={busy || steering} />
                    </label>
                  )
                : (
                    <label key={k} className="block">
                      <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{k}</span>
                      <input className={fieldClass} value={v} onChange={ev => setEdited(e => ({ ...e, [k]: ev.target.value }))} disabled={busy || steering} />
                    </label>
                  )
            ))}
          </div>

          {/* Steer — tell the agent what to change; it rewrites, you re-review. */}
          <div className="mt-3 flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-brand-amber"
              placeholder="Steer the agent — e.g. shorter, mention the July 20 call, firmer ask"
              value={steer}
              onChange={ev => setSteer(ev.target.value)}
              disabled={busy || steering}
              onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void onSteer(); } }}
            />
            <Button size="sm" variant="outline" onClick={() => void onSteer()} disabled={busy || steering}>
              {steering ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Rewrite
            </Button>
          </div>

          {/* Raw payload demoted to a drill — never the surface. */}
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-muted-foreground transition hover:text-foreground">raw payload</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px] break-words whitespace-pre-wrap">{JSON.stringify(current.input, null, 2)}</pre>
          </details>

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
              {desc.isEmail ? (current.input.draft === true ? 'Approve → draft' : 'Approve & send') : 'Approve'}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Edit anything above — your version is exactly what runs. Nothing executes without you.</p>
        </div>
      </div>

      {/* Up-next rail — jump anywhere; Back returns. */}
      {queue.length > 1 && (
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="mb-2 px-1 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Up next</div>
          <ul className="space-y-1.5">
            {queue.filter(i => i.id !== current.id).slice(0, 8).map((item) => {
              const d = describeAction(item);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => goTo(item.id)}
                    className="group flex w-full items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2 text-left text-xs transition hover:border-brand-amber/40"
                  >
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    <ArrowRight className="size-3 shrink-0 text-muted-foreground/50 transition group-hover:text-brand-amber-deep" aria-hidden />
                  </button>
                </li>
              );
            })}
            {queue.length > 9 && <li className="px-2.5 text-[11px] text-muted-foreground/60">+{queue.length - 9} more</li>}
          </ul>
        </aside>
      )}
    </div>
  );
}
