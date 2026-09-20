'use client';

import type { ActionRun } from '@/features/review/ReviewFocusView';
import type { ProposalQueueEntry } from '@/services/InboxService';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { describeAction, ReviewFocusView } from '@/features/review/ReviewFocusView';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { shortcutFor } from '@/features/review/reviewShortcuts';
import { showLearnedToast } from '@/features/review/showLearnedToast';
import { isSelfUpdate } from '@/libs/actions/selfUpdate';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { inboxHref } from '@/services/inbox/inboxRef';
import { decisionCrumbs } from './inbox/inboxMeta';
import { withMinimumPending } from './inbox/pending';

/**
 * The `proposal` kind's decision screen on "Review queue" — the data half. The
 * server page (`/dashboard/inbox/proposal-:id`) loads the run with its card
 * and alignment, plus the working queue: every open proposal in the order
 * and under the filters the list showed them. This container owns what
 * happens around the decision — skip/back/save, the generic edit-and-steer
 * path, the queue keyboard (`j`/`k`/`?`) — and where to go next. The page
 * itself is `features/review/ReviewFocusView`; the item's own decision
 * (`a`/`d`/`s`) belongs to the card.
 *
 * The queue lives in the URL, not in component state: Up-next and `j`/`k`
 * navigate to the next proposal's own address with the list's filters kept
 * in the query string, so a reload, a shared link or the back button land
 * exactly where a person was. Deciding moves to the next proposal in the
 * queue — that IS the queue, and the toast names what you just did while you
 * read the next one. When the queue runs out it does NOT dump you on the
 * list: it says the queue is clear and gives you a button back, because a
 * redirect nobody asked for reads as losing your place (Chris, 2026-09-16).
 *
 * No popups. gmail.send never auto-sends. The run record in the database is
 * the debugging surface — no raw payload here.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function ReviewFocus(props: {
  run: ActionRun;
  /** The open proposals under the list's filters, in list order (`listProposalQueue`). */
  queue: ProposalQueueEntry[];
  /** The list's query string (`?kind=proposal&actionKind=…`), carried onto every neighbour's URL. */
  search: string;
  /** Where "done" goes: the list, filtered as it was. */
  listHref: string;
}) {
  const router = useRouter();
  const { run, queue, search, listHref } = props;
  const [busy, setBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [steering, setSteering] = useState(false);
  const [steer, setSteer] = useState('');
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [decided, setDecided] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  /** Set when the last proposal in the queue is decided — the only exit is a button. */
  const [cleared, setCleared] = useState(false);
  // Skipped ids fall to the back of the working queue for this visit.
  const [skipped, setSkipped] = useState<number[]>([]);

  const index = queue.findIndex(q => q.id === run.id);
  const ordered = useMemo(() => {
    // Items after the current one first, then wrap to the ones before it;
    // anything skipped this visit falls to the back.
    const walk = [...queue.slice(index + 1), ...(index >= 0 ? queue.slice(0, index) : [])];
    return [...walk.filter(q => !skipped.includes(q.id)), ...walk.filter(q => skipped.includes(q.id))];
  }, [queue, index, skipped]);
  const next = ordered[0];
  const prev = index > 0 ? queue[index - 1] : undefined;

  const hrefFor = useCallback((id: number) => `${inboxHref('proposal', id)}${search}`, [search]);
  const goTo = useCallback((id: number) => router.push(hrefFor(id)), [router, hrefFor]);
  const leave = useCallback(() => {
    if (next) {
      router.push(hrefFor(next.id));
      router.refresh();
      return;
    }
    // Nothing else is waiting: say so here rather than redirecting.
    setCleared(true);
    router.refresh();
  }, [next, router, hrefFor]);

  // Editable working copy of a presenter-less item's human fields.
  useEffect(() => {
    setSteer('');
    if (describeAction(run).isEmail) {
      setEdited({ to: str(run.input.to), subject: str(run.input.subject), body: str(run.input.body) });
    } else {
      const properties = (run.input.properties ?? {}) as Record<string, unknown>;
      setEdited(Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, str(v)])));
    }
  }, [run.id]);

  const signal = (s: 'skip') => {
    void client.review.recordSignal({ runId: run.id, signal: s }).catch(() => {});
  };

  const onBack = () => {
    if (prev) {
      goTo(prev.id);
    } else {
      router.back();
    }
  };

  const onSkip = () => {
    if (!next) {
      return;
    }
    signal('skip');
    setSkipped(s => [...s, run.id]);
    goTo(next.id);
  };

  const buildEditedInput = (): Record<string, unknown> | undefined => {
    if (describeAction(run).isEmail) {
      return { ...run.input, ...edited };
    }
    if (run.input.properties) {
      return { ...run.input, properties: { ...(run.input.properties as Record<string, unknown>), ...edited } };
    }
    return undefined;
  };

  const onDecide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    const title = describeAction(run).title;
    try {
      const editedInput = decision === 'approve' ? buildEditedInput() : undefined;
      const outcome = await withMinimumPending(client.review.decideAction({ id: run.id, decision, ...(editedInput ? { editedInput } : {}) }));
      if (decision === 'approve' && outcome.execution?.status === 'failed') {
        toast.error(`Approved, but it failed to run · ${title}`, { description: outcome.execution.error ?? 'The action threw. It stays on the review queue; Approve again to retry.' });
        router.refresh();
        return;
      }
      setDecided(d => d + 1);
      toast.success(`${decision === 'approve' ? 'Approved' : 'Declined'} · ${title}`, {
        description: decision === 'approve' ? (editedInput ? 'Your edited version is executing now.' : 'Executing now.') : 'Nothing runs; the agent learns from it.',
      });
      // The same second line the card's own surface says (principle 6: one
      // shape) — what the decision TAUGHT, with Undo where there is something
      // to put back. This page has no note field, so nothing is queued as a rule.
      showLearnedToast({ decision, actionId: run.actionId, runId: run.id, hasNote: false, undoable: isSelfUpdate(run.actionId) });
      leave();
    } catch (err) {
      toast.error(`Could not ${decision === 'approve' ? 'approve' : 'decline'} · ${title}`, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const onSnooze = async (days: number) => {
    setBusy(true);
    const title = describeAction(run).title;
    const until = new Date(Date.now() + days * 86_400_000);
    try {
      await withMinimumPending(client.review.snoozeAction({ id: run.id, until: until.toISOString() }));
      setSnoozeOpen(false);
      setDecided(d => d + 1);
      toast.info(`Snoozed · ${title}`, { description: `Back on the review queue ${until.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}.` });
      leave();
    } catch (err) {
      toast.error(`Could not snooze · ${title}`, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  // The card owns its own decide/snooze; this just moves on. A regenerate is
  // NOT a decision: the card holds its place and the page re-reads the run.
  const onCardDecided = (outcome: 'approve' | 'reject' | 'snooze' | 'regenerate') => {
    if (outcome === 'regenerate') {
      router.refresh();
      return;
    }
    // The card has already said what happened (its own toast); this moves on.
    setDecided(d => d + 1);
    leave();
  };

  const onSteer = async () => {
    setSteering(true);
    try {
      const res = await client.review.rewriteDraft({ runId: run.id, hint: steer.trim() || undefined });
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
      } else if (!run.card && !busy && !steering) {
        if (action === 'approve') {
          e.preventDefault();
          void onDecide('approve');
        } else if (action === 'decline') {
          e.preventDefault();
          void onDecide('reject');
        } else if (action === 'snooze') {
          e.preventDefault();
          setSnoozeOpen(o => !o);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const upNext = ordered.slice(0, 10).map(q => ({ id: q.id, title: q.title, typeLabel: q.typeLabel }));
  const record = run.card?.subject?.name ?? describeAction(run).title;

  if (cleared) {
    return (
      <div className="mx-auto w-full max-w-3xl" data-testid="review-cleared">
        <ReviewHeader crumbs={decisionCrumbs('proposal', record)} title="Queue clear" system="Recommendations" status="done" position={`${decided} decided this visit`} />
        <p className="mt-3 text-sm text-muted-foreground">Nothing else in this queue is waiting on you.</p>
        <p className="mt-4">
          <Link href={listHref} className="text-sm text-primary underline-offset-2 hover:underline" data-testid="review-cleared-back">Back to the review queue</Link>
        </p>
      </div>
    );
  }

  return (
    <ReviewFocusView
      loaded
      crumbs={decisionCrumbs('proposal', record)}
      current={run}
      index={index}
      total={queue.length}
      upNext={upNext}
      onSkipTo={goTo}
      canBack={Boolean(prev)}
      onBack={onBack}
      onSkip={onSkip}
      onCardDecided={onCardDecided}
      onCardRegenerated={() => router.refresh()}
      edited={edited}
      onEditField={(k, v) => setEdited(e => ({ ...e, [k]: v }))}
      steer={steer}
      onSteerChange={setSteer}
      onSteer={() => void onSteer()}
      steering={steering}
      busy={busy}
      onDecide={d => void onDecide(d)}
      snoozeOpen={snoozeOpen}
      onToggleSnooze={() => setSnoozeOpen(o => !o)}
      onSnooze={d => void onSnooze(d)}
      decided={decided}
      showHelp={showHelp}
      onToggleHelp={() => setShowHelp(h => !h)}
    />
  );
}
