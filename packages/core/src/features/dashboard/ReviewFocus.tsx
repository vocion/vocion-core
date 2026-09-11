'use client';

import type { ReviewCard } from '@/libs/actions/types';
import { ArrowLeft, ArrowRight, Bookmark, Check, Loader2, Mail, RefreshCw, ShieldCheck, SkipForward, Sparkles, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TokenSelect } from '@/components/ui/token-select';
import { ReviewActionCard } from '@/features/review/ReviewActionCard';
import { client } from '@/libs/Orpc';
import { useDockOpen } from './chat/dockState';
import { upNextPage } from './upNextPage';

/** One card type pending for the org, with its real count and registered name. */
type ReviewType = { actionId: string; label: string; count: number };

/**
 * Review — FOCUS MODE with a human header. Every item leads with WHAT is
 * being approved in plain language (the action, the system it touches, the
 * concrete changes). No raw payload anywhere on the surface: the run record
 * in the database is the debugging surface.
 *
 * An action that presents a structured card renders through the shared
 * `ReviewActionCard` template — the same card, editing, note, snooze and
 * decide path every deciding surface uses. Actions without one keep the
 * generic layout below: steerable, editable in place. Back returns to the
 * previous item; the Up-next rail jumps anywhere. No popups. gmail.send
 * never auto-sends.
 */

type ActionRun = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  invokedBy: string | null;
  createdAt: string | Date;
  proposal: { confidence?: number; rationale?: string } | null;
  /** Structured presentation, when the action defines one (server-built). */
  card?: ReviewCard;
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
 * @param p
 */
function describeAction(p: ActionRun): { title: string; system: string; isEmail: boolean } {
  const input = p.input;
  // An action that presents itself wins — one definition, consistent cards.
  if (p.card) {
    return { title: p.card.title, system: p.card.system ?? p.actionId.split('.')[0] ?? 'system', isEmail: false };
  }
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
  const router = useRouter();
  const params = useSearchParams();
  // The filter lives in the URL: a filtered queue survives a reload and can be
  // sent to whoever should work it. Repeated `?type=` params, so several card
  // types can be worked as one queue.
  const activeTypes = params.getAll('type').flatMap(v => v.split(',')).filter(Boolean);
  // The array identity changes every render; the VALUE is what the fetch depends on.
  const typeKey = activeTypes.join(',');
  const [items, setItems] = useState<ActionRun[]>([]);
  const [types, setTypes] = useState<ReviewType[]>([]);
  const [total, setTotal] = useState(0);
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
      // The filter goes to the SERVER, so a filtered queue draws its whole
      // window from the matching rows. Filtering the fetched page instead
      // would show whichever of the newest 50 happened to match.
      const chosen = typeKey === '' ? [] : typeKey.split(',');
      const [page, present] = await Promise.all([
        client.review.listPendingActions(chosen.length > 0 ? { actionIds: chosen } : {}),
        client.review.listPendingActionTypes(),
      ]);
      setItems(page.items as ActionRun[]);
      setTotal(page.total);
      setTypes(present as ReviewType[]);
    } catch {
      setItems([]);
      setTypes([]);
      setTotal(0);
    }
    setLoaded(true);
  }, [typeKey]);

  useEffect(() => {
    // A new filter is a new queue: the skip/back state belonged to the old one.
    setSkipped(new Set());
    setHistory([]);
    setPinnedId(null);
    void refresh();
  }, [refresh]);

  const selectTypes = (next: string[]) => {
    const qs = new URLSearchParams(params.toString());
    qs.delete('type');
    for (const value of next) {
      qs.append('type', value);
    }
    const search = qs.toString();
    router.push(search ? `/dashboard/review?${search}` : '/dashboard/review');
  };

  const typeTotal = types.reduce((sum, t) => sum + t.count, 0);
  const filter = (
    <div className="mb-4" data-testid="review-type-filter">
      <TokenSelect
        label="Filter by card type"
        options={types.map(t => ({ value: t.actionId, label: t.label, count: t.count }))}
        selected={activeTypes}
        onChange={selectTypes}
        placeholder="Filter"
        emptyLabel={`All types · ${typeTotal}`}
      />
    </div>
  );

  const queue = [...items.filter(i => !skipped.has(i.id)), ...items.filter(i => skipped.has(i.id))];
  const current = (pinnedId != null && items.find(i => i.id === pinnedId)) || queue[0];
  // The Up-next rail gives way to the conversation dock: folded to its header
  // while the dock is open, unless the person opens it by hand; the hand
  // choice resets when the dock changes (Valerie, 2026-09-10). "+N more"
  // grows the list by a page of fifty per click.
  const dockOpen = useDockOpen();
  const [railChoice, setRailChoice] = useState<boolean | null>(null);
  const [railExpansions, setRailExpansions] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setRailChoice(null);
  }, [dockOpen]);
  const railFolded = railChoice ?? dockOpen;
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * "+N more": widen the rail's window by a page and, when the loaded queue is
   * shorter than the queue itself, fetch the next page from the server and
   * append it (deduped by id, since the queue can move under us).
   */
  const showMoreUpNext = useCallback(async () => {
    setRailExpansions(n => n + 1);
    if (items.length >= total || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const chosen = typeKey === '' ? [] : typeKey.split(',');
      const page = await client.review.listPendingActions({
        ...(chosen.length > 0 ? { actionIds: chosen } : {}),
        limit: 50,
        offset: items.length,
      });
      setItems((prev) => {
        const seen = new Set(prev.map(i => i.id));
        return [...prev, ...(page.items as ActionRun[]).filter(i => !seen.has(i.id))];
      });
      setTotal(page.total);
    } catch {
      /* the window still widened over what is loaded; the next click retries */
    } finally {
      setLoadingMore(false);
    }
  }, [items.length, total, loadingMore, typeKey]);
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
  }, [current?.id]);

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
    setSkipped((s) => {
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

  // The shared card owns its own decide/snooze; this just drops the item.
  const onCardDecided = () => {
    if (!current) {
      return;
    }
    setItems(prev => prev.filter(i => i.id !== current.id));
    setPinnedId(null);
    setDecided(d => d + 1);
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
    const chosen = types.filter(ty => activeTypes.includes(ty.actionId));
    const chosenLabel = chosen.length === 1 ? chosen[0]!.label : null;
    return (
      <>
        {filter}
        <div className="rounded-2xl border border-border px-6 py-12 text-center">
          <ShieldCheck className="mx-auto size-8 text-brand-amber-deep" aria-hidden />
          <div className="mt-2 text-base font-semibold">
            {chosenLabel
              ? `No ${chosenLabel} cards left`
              : activeTypes.length > 0 ? 'None of these types left' : 'All caught up'}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {decided > 0 ? `${decided} handled this session. ` : ''}
            {activeTypes.length > 0
              ? 'Other card types are still waiting — clear the filter to see them.'
              : 'New agent proposals land here for your decision.'}
          </p>
        </div>
      </>
    );
  }

  const pct = current.proposal?.confidence !== undefined ? Math.round(current.proposal.confidence * 100) : null;
  const fieldClass = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-brand-amber';
  const longField = desc.isEmail ? 'body' : 'notes';

  return (
    <>
      {filter}
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
            {/* The queue's real size, not the window's: a page of 50 out of 557
              pending items reads as "50 in queue" and hides the backlog. */}
            <span className="font-mono text-[11px] text-muted-foreground" title={total > queue.length ? `${queue.length} loaded of ${total} matching` : undefined}>
              {total}
              {' '}
              in queue
            </span>
          </div>

          {current.card && (
            <ReviewActionCard run={{ ...current, card: current.card }} onDecided={onCardDecided} />
          )}

          {!current.card && (
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
                    {pct !== null && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone(current.proposal?.confidence)}`}>
                        {pct}
                        %
                      </span>
                    )}
                    {current.input.draft === true && <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">dry run → Drafts</span>}
                    {current.invokedBy && <span className="text-[11px] text-muted-foreground">{current.invokedBy.replace('agent:', 'proposed by ')}</span>}
                  </div>
                </div>
              </div>
              {/* Card-carrying runs render through ReviewActionCard above; here the rationale is the surface. */}
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
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') {
                      ev.preventDefault();
                      void onSteer();
                    }
                  }}
                />
                <Button size="sm" variant="outline" onClick={() => void onSteer()} disabled={busy || steering}>
                  {steering ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  Rewrite
                </Button>
              </div>

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
            </div>
          )}
        </div>

        {/* Up-next rail — jump anywhere; Back returns. Folds to its header
            while the dock is open; "+N more" pages the list by fifty. */}
        {queue.length > 1 && (() => {
          const others = queue.filter(i => i.id !== current.id);
          // Counted against the whole queue, not just what is loaded: "+141
          // more" with 150 in the queue, however many rows the page holds.
          const upNextTotal = Math.max(total - 1, others.length);
          const { shown, remaining } = upNextPage(upNextTotal, railExpansions);
          return (
            <aside aria-label="Up next" className={`hidden shrink-0 lg:block ${railFolded ? 'w-auto' : 'w-64'}`}>
              <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                <span>
                  Up next
                  {railFolded ? ` · ${upNextTotal}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setRailChoice(!railFolded)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-muted-foreground normal-case transition hover:bg-muted hover:text-foreground"
                  aria-expanded={!railFolded}
                >
                  {railFolded ? 'Show' : 'Hide'}
                </button>
              </div>
              {!railFolded && (
                <ul className="space-y-1.5">
                  {others.slice(0, shown).map((item) => {
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
                  {remaining > 0 && (
                    <li>
                      <button
                        type="button"
                        onClick={() => void showMoreUpNext()}
                        disabled={loadingMore}
                        className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60"
                      >
                        +
                        {remaining}
                        {' '}
                        more
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </aside>
          );
        })()}
      </div>
    </>
  );
}
