'use client';

import type { ActionRun } from '@/features/review/ReviewFocusView';
import type { ReviewType } from '@/features/review/reviewQueueModel';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { describeAction, ReviewFocusView } from '@/features/review/ReviewFocusView';
import { typeLabel } from '@/features/review/reviewQueueModel';
import { shortcutFor } from '@/features/review/reviewShortcuts';
import { client } from '@/libs/Orpc';

/**
 * Review — FOCUS MODE: one item at a time, decide and move on. This is the
 * data half: the queue window, the type filter in the URL, skip/back/save,
 * the generic edit-and-steer path, and the queue keyboard (`j`/`k`/`?`). The
 * page itself is `features/review/ReviewFocusView`; the item's own decision
 * (`a`/`d`/`s`) belongs to the card in page presentation.
 *
 * No popups. gmail.send never auto-sends. The run record in the database is
 * the debugging surface — no raw payload here.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function ReviewFocus() {
  const router = useRouter();
  const params = useSearchParams();
  // The filter lives in the URL: a filtered queue survives a reload and can be
  // sent to whoever should work it. Repeated `?type=` params, so several card
  // types can be worked as one queue.
  const activeTypes = params.getAll('type').flatMap(v => v.split(',')).filter(Boolean);
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // The filter goes to the SERVER, so a filtered queue draws its whole
      // window from the matching rows.
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

  const queue = [...items.filter(i => !skipped.has(i.id)), ...items.filter(i => skipped.has(i.id))];
  const current = (pinnedId != null && items.find(i => i.id === pinnedId)) || queue[0] || null;
  const index = current ? queue.findIndex(i => i.id === current.id) : -1;

  /** Widen the loaded window by a page when the Up-next menu asks for more. */
  const loadMore = useCallback(async () => {
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
      /* the next open retries */
    } finally {
      setLoadingMore(false);
    }
  }, [items.length, total, loadingMore, typeKey]);

  // Editable working copy of a presenter-less item's human fields.
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
    if (describeAction(current).isEmail) {
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

  // The card owns its own decide/snooze; this just drops the item. A
  // regenerate is NOT a decision: the card holds its place — pinned, so the
  // queue cannot advance past it.
  const onCardDecided = (outcome: 'approve' | 'reject' | 'snooze' | 'regenerate') => {
    if (!current) {
      return;
    }
    if (outcome === 'regenerate') {
      setPinnedId(current.id);
      return;
    }
    setItems(prev => prev.filter(i => i.id !== current.id));
    setPinnedId(null);
    setDecided(d => d + 1);
  };

  const onCardRegenerated = () => {
    void refresh();
  };

  const onSteer = async () => {
    if (!current) {
      return;
    }
    setSteering(true);
    try {
      const res = await client.review.rewriteDraft({ runId: current.id, hint: steer.trim() || undefined });
      setEdited(e => ('body' in e ? { ...e, body: res.body } : { ...e, notes: res.body }));
      setSteer('');
    } catch {
      /* keep current text */
    } finally {
      setSteering(false);
    }
  };

  // Queue keyboard: j next, k back, ? help. Approve/decline/snooze on a card
  // item are the card's keys; a generic item takes them here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null });
      if (!action) {
        return;
      }
      if (action === 'next') {
        e.preventDefault();
        onSkip();
      } else if (action === 'prev') {
        e.preventDefault();
        onBack();
      } else if (action === 'help') {
        e.preventDefault();
        setShowHelp(h => !h);
      } else if (current && !current.card && !busy && !steering) {
        if (action === 'approve') {
          e.preventDefault();
          void onDecide('approve');
        } else if (action === 'decline') {
          e.preventDefault();
          void onDecide('reject');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const upNext = queue
    .filter(i => i.id !== current?.id)
    .slice(0, 10)
    .map(i => ({ id: i.id, title: describeAction(i).title, typeLabel: typeLabel(types, i.actionId) }));

  return (
    <ReviewFocusView
      loaded={loaded}
      types={types}
      activeTypes={activeTypes}
      onChangeTypes={selectTypes}
      current={current}
      index={index}
      total={total}
      upNext={upNext}
      onSkipTo={goTo}
      onLoadMore={items.length < total ? () => void loadMore() : undefined}
      canBack={history.length > 0}
      onBack={onBack}
      onSkip={onSkip}
      onSave={onSave}
      onCardDecided={onCardDecided}
      onCardRegenerated={onCardRegenerated}
      edited={edited}
      onEditField={(k, v) => setEdited(e => ({ ...e, [k]: v }))}
      steer={steer}
      onSteerChange={setSteer}
      onSteer={() => void onSteer()}
      steering={steering}
      busy={busy}
      onDecide={d => void onDecide(d)}
      decided={decided}
      showHelp={showHelp}
      onToggleHelp={() => setShowHelp(h => !h)}
    />
  );
}
