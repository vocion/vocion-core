'use client';

import type { SheetAsk } from './AskSheet';
import type { WorkCardModel } from '@/features/review/reviewSheetModel';
import type { ActionChange } from '@/services/inbox/describeActionRun';
import type { ReviewContextModel } from '@/services/inbox/reviewContextModel';
import { useState } from 'react';
import { ReviewContextRail } from '@/features/review/ReviewContextRail';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { editedInputFor, hasEdits, splitReviewContext } from '@/features/review/reviewSheetModel';
import { ReviewWhy } from '@/features/review/ReviewWhy';
import { ReviewWorkCard } from '@/features/review/ReviewWorkCard';
import { Link } from '@/libs/I18nNavigation';
import { inboxHref } from '@/services/inbox/inboxRef';
import { AskSheet } from './AskSheet';
import { agoLabel, waitingFor } from './inboxMeta';

/** One already-decided proposal about this record, as the server hands it over. */
export type DecidedProposal = {
  id: number;
  title: string;
  subline: string;
  /** `rejected` reads as Declined; anything else as Approved. */
  status: string;
  /** ISO, or null for one decided in this visit. */
  decidedAt: string | null;
};

/** Why one recommendation is on the sheet — the reason, who, since when, how sure. */
export type SheetReason = {
  reason: string | null;
  runId: number;
  since: string | null;
  agentSlug: string | null;
  confidence: number | null;
  /** "Email", "CRM update" — the action's own kind, for the header's eyebrow. */
  actionKind: string;
  /** What this recommendation would write, for the context pane's Changes group. */
  changes: ActionChange[];
};

/**
 * One record's decision sheet: the work first, one place to act on it, and
 * everything else one click behind "Why this?".
 *
 * Rebuilt 2026-09-19 against Chris's list. What each line of it changed:
 *
 * - *"actual work to approve is buried in the middle of everything … this
 *   should probably be the first"* → `ReviewWorkCard` is the first thing in
 *   the content column, framed as the ONE `Surface` on the page and rendered
 *   as the thing it is (a composer for an email, a field diff for a CRM
 *   update). Editable in place; the edited version is what runs.
 * - *"approve / reject action is below the fold"* and *"approve/next shouldn't
 *   be in 2 places"* → the radio rows are gone and the sticky bar carries the
 *   verbs. One bar, always on screen, at 390px too.
 * - *"no clear way to approve w/ feedback/direction"* → the bar's field.
 *   Typing in it makes the primary *Approve with changes* and offers *Send
 *   back with direction*; both ride the feedback paths that already exist.
 * - *"too much in the head/header as context? maybe it should be explorable"*
 *   → `ReviewWhy`. The reason, the run id, the waiting time, the confidence,
 *   the payload, the citations AND this record's earlier decisions live in one
 *   fold that remembers whether you like it open.
 * - *"inbox/outbox should include more search context than just email … click
 *   to preview pane"* → `ReviewContextRail`.
 *
 * Deciding still keeps you here: the sheet steps to the record's next open
 * recommendation, the one just decided drops into "Just decided", and only
 * when nothing is left does it offer a button back (Chris, 2026-09-16: *"It
 * redirected me back to the review queue list with no context"*).
 * @param props
 * @param props.open - The record's open recommendations, as sheet questions.
 * @param props.decided - What has already been decided about this record.
 * @param props.title - The record's name.
 * @param props.crumbs - Breadcrumb for the header.
 * @param props.reasons - Per open recommendation: why it is here, and its facts.
 * @param props.works - Per open recommendation: the payload, as the thing it is.
 * @param props.inputs - Per open recommendation: the payload as proposed, so an edit can be approved with.
 * @param props.contexts - Per open recommendation: the record's context, for the pane.
 */
export function RecordSheet({ open, decided, title, crumbs, reasons = {}, works = {}, inputs = {}, contexts = {} }: {
  open: SheetAsk[];
  decided: DecidedProposal[];
  title: string;
  crumbs: Array<{ label: string; href?: string }>;
  reasons?: Record<number, SheetReason>;
  works?: Record<number, WorkCardModel>;
  inputs?: Record<number, Record<string, unknown>>;
  contexts?: Record<number, ReviewContextModel>;
}) {
  const [justDecided, setJustDecided] = useState<DecidedProposal[]>([]);
  /** The reviewer's working copy of each recommendation's payload, by run id. */
  const [edits, setEdits] = useState<Record<number, Record<string, string>>>({});
  const rows = [...justDecided, ...decided];

  /**
   * What you did in THIS visit stays on screen; what was decided before it
   * folds into "Why this?" with the rest of the record's history.
   *
   * Chris, 2026-09-17: *"i don't want to see historical all decided when
   * clicking into a review decision."* The row you just approved is feedback —
   * it is the reason this page does not navigate away. Everything decided
   * before you arrived is audit material: true, worth keeping, and not what
   * you came to this screen to read (principle 9 — hide complexity, never hide
   * truth).
   */
  const history = decided;

  const editsFor = (id: number) => edits[id] ?? {};
  const editedInput = (ask: SheetAsk) => {
    const model = works[ask.id];
    const input = inputs[ask.id];
    return model && input ? editedInputFor(model, input, editsFor(ask.id)) : undefined;
  };

  return (
    // No width here: `AskSheet` owns the column, and it widens itself when a
    // context pane stands beside the decision.
    <div className={open.length > 0 ? 'w-full' : 'mx-auto w-full max-w-3xl'} data-testid="record-sheet">
      {open.length > 0
        ? (
            <AskSheet
              asks={open}
              title={title}
              endpoint="review"
              allowOther={false}
              kind="proposal"
              crumbs={crumbs}
              decide="verbs"
              editedInputFor={editedInput}
              work={ask => (works[ask.id]
                ? (
                    <ReviewWorkCard
                      model={works[ask.id]!}
                      edits={{
                        value: editsFor(ask.id),
                        onEdit: (key, value) => setEdits(e => ({ ...e, [ask.id]: { ...(e[ask.id] ?? {}), [key]: value } })),
                      }}
                    />
                  )
                : null)}
              why={(ask, parts) => {
                const r = reasons[ask.id];
                const model = works[ask.id];
                const { why } = splitReviewContext({
                  title: ask.title,
                  kindLabel: r?.actionKind ?? 'Recommendation',
                  askedBy: r?.agentSlug ?? ask.agentSlug,
                  confidence: r?.confidence ?? null,
                  index: Math.max(open.findIndex(a => a.id === ask.id), 0),
                  total: open.length,
                  reason: r?.reason ?? null,
                  runId: r?.runId ?? ask.id,
                  waiting: r?.since ? waitingFor(new Date(r.since)) : null,
                  earlierDecisions: history.length,
                });
                return (
                  <div className="mt-4">
                    <ReviewWhy why={why}>
                      {model && hasEdits(model, editsFor(ask.id)) && (
                        <p className="mt-3 text-[12px] text-brand-amber-deep" data-testid="review-why-edited">
                          You have edited this recommendation. Approving runs your version.
                        </p>
                      )}
                      {parts.lead && <div className="mt-3 border-t border-rule pt-3">{parts.lead}</div>}
                      {parts.details && <div className="mt-3 border-t border-rule pt-3">{parts.details}</div>}
                      {history.length > 0 && (
                        <section className="mt-3 border-t border-rule pt-3" data-testid="record-history">
                          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            {`${history.length} earlier ${history.length === 1 ? 'decision' : 'decisions'} about this record`}
                          </h3>
                          <DecidedList rows={history} />
                        </section>
                      )}
                    </ReviewWhy>
                  </div>
                );
              }}
              aside={ask => (
                <ReviewContextRail
                  context={contexts[ask.id] ?? null}
                  // An email's describer emits `subject` as a change so the
                  // LIST row can name it. The composer above already shows it,
                  // so the pane would be saying it twice.
                  changes={works[ask.id]?.shape === 'email' ? [] : reasons[ask.id]?.changes ?? []}
                  evidence={ask.evidence ?? []}
                />
              )}
              onDecided={(ask, decision) => setJustDecided(d => [
                { id: ask.id, title: ask.title, subline: ask.subline ?? decision.label, status: decision.id === 'approve' ? 'done' : 'rejected', decidedAt: null },
                ...d,
              ])}
            />
          )
        : <ReviewHeader crumbs={crumbs} title={title} system="Record" status="done" position={`${rows.length} decided`} />}

      {justDecided.length > 0 && (
        <section className={open.length > 0 ? 'mt-8' : 'mt-4'} data-testid="record-decided">
          <h2 className="mb-1 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Just decided
            {' '}
            <span className="font-normal text-muted-foreground/70 tabular-nums">{justDecided.length}</span>
          </h2>
          <DecidedList rows={justDecided} />
        </section>
      )}

      {/* With nothing open, the fold that would hold the history is not on the
          page — so the record's own record stays here rather than vanishing. */}
      {open.length === 0 && history.length > 0 && (
        <section className="mt-6" data-testid="record-history">
          <h2 className="mb-1 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {`${history.length} earlier ${history.length === 1 ? 'decision' : 'decisions'} about this record`}
          </h2>
          <DecidedList rows={history} />
        </section>
      )}
    </div>
  );
}

/**
 * One decided recommendation per row — what it was, how it went, when.
 * @param props
 * @param props.rows
 */
function DecidedList({ rows }: { rows: DecidedProposal[] }) {
  return (
    <ul className="divide-y divide-border border-y border-border text-sm">
      {rows.map(row => (
        <li key={row.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
          <Link href={inboxHref('proposal', row.id)} className="min-w-0 flex-1 hover:underline">
            <span className="block truncate">{row.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{row.subline}</span>
          </Link>
          <span className={`shrink-0 text-xs font-medium ${row.status === 'rejected' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {row.status === 'rejected' ? 'Declined' : 'Approved'}
          </span>
          <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {row.decidedAt ? agoLabel(new Date(row.decidedAt)) : 'just now'}
          </span>
        </li>
      ))}
    </ul>
  );
}
