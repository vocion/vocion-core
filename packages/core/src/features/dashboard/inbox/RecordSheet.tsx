'use client';

import type { SheetAsk } from './AskSheet';
import { useState } from 'react';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { Link } from '@/libs/I18nNavigation';
import { inboxHref } from '@/services/inbox/inboxRef';
import { AskSheet } from './AskSheet';
import { agoLabel } from './inboxMeta';

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

/**
 * One record's decision sheet, and the record of what has already been
 * decided about it — together, on one page, in one client component.
 *
 * Deciding here keeps you here. The sheet steps to the record's next open
 * proposal; the one just decided drops into the Decided list below, marked
 * "just now"; and when nothing is left the sheet says so and offers a button
 * back. Nothing navigates on its own, and nothing depends on a `router.refresh`
 * landing before the reader looks up — the page already holds everything it
 * needs to be right (Chris, 2026-09-16: "It redirected me back to the review queue
 * list with no context").
 * @param props
 * @param props.open - The record's open proposals, as sheet questions.
 * @param props.decided - What has already been decided about this record.
 * @param props.title - The record's name.
 * @param props.crumbs - Breadcrumb for the header.
 */
export function RecordSheet({ open, decided, title, crumbs }: {
  open: SheetAsk[];
  decided: DecidedProposal[];
  title: string;
  crumbs: Array<{ label: string; href?: string }>;
}) {
  const [justDecided, setJustDecided] = useState<DecidedProposal[]>([]);
  const rows = [...justDecided, ...decided];

  return (
    <div className="mx-auto w-full max-w-3xl" data-testid="record-sheet">
      {open.length > 0
        ? (
            <AskSheet
              asks={open}
              title={title}
              endpoint="review"
              allowOther={false}
              kind="proposal"
              crumbs={crumbs}
              onDecided={(ask, decision) => setJustDecided(d => [
                { id: ask.id, title: ask.title, subline: ask.subline ?? decision.label, status: decision.id === 'approve' ? 'done' : 'rejected', decidedAt: null },
                ...d,
              ])}
            />
          )
        : <ReviewHeader crumbs={crumbs} title={title} system="Record" status="done" position={`${rows.length} decided`} />}

      {rows.length > 0 && (
        <section className={open.length > 0 ? 'mt-8' : 'mt-4'} data-testid="record-decided">
          <h2 className="mb-1 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Decided
            {' '}
            <span className="font-normal text-muted-foreground/70 tabular-nums">{rows.length}</span>
          </h2>
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
        </section>
      )}
    </div>
  );
}
