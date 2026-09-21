'use client';

import type { ContextPaneLabels, ContextPaneRow } from './reviewSheetModel';
import type { ActionChange } from '@/services/inbox/describeActionRun';
import type { ReviewContextModel } from '@/services/inbox/reviewContextModel';
import { ChevronRight, MessageSquareText, Search, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { agoLabel } from '@/features/dashboard/inbox/inboxMeta';
import { PreviewPane } from '@/features/preview/PreviewPane';
import { contextPaneRows, filterContextRows, groupContextRows } from './reviewSheetModel';

/**
 * The context pane beside a decision: not a wall of read-only sections, but a
 * searchable list of everything the record actually has — the CRM contact,
 * every thread both ways, the sequence state, the changes this recommendation
 * would write, and the documents it cites — where **clicking a row previews it
 * in the pane** instead of navigating away from the decision.
 *
 * Chris, 2026-09-19: *"inbox/outbox should include more search context than
 * just email. and should be click to preview pane for details."*
 *
 * It reuses `PreviewPane` — the same anatomy every peek in the product has
 * (icon, title, link out, then the body) with its `back` affordance — rather
 * than growing a second preview. Two things are deliberately different from
 * the rail's peek, and both are about this pane being *inside* the page:
 *
 * - **The selection is local state, not `?preview=`.** The decision screen
 *   mounts `ChatDock`, which paints the global peek in the right rail; driving
 *   this pane off the same URL param would show the same record twice and
 *   push a history entry per row (`docs/design/patterns.md` — one right column).
 * - **The rows that are local facts carry their own `doc`.** The page already
 *   assembled them on the server, so the pane paints with no round trip. A
 *   citation is the exception: it IS a record elsewhere, so it has a `ref` and
 *   the preview registry resolves it exactly as it does everywhere else.
 *
 * "Ask about this contact" stays, and still hands the question to the page's
 * own agent surface so the answer arrives beside the decision.
 * @param props
 * @param props.context - The assembled contact context, when the proposal is about an address.
 * @param props.contextRead
 * @param props.changes - What this recommendation would write.
 * @param props.evidence - The citations behind it.
 */
export function ReviewContextRail({ context, contextRead, changes, evidence }: {
  context?: ReviewContextModel | null;
  /** False when the server did not attempt a context read for this recommendation. */
  contextRead?: boolean;
  changes?: readonly ActionChange[];
  evidence?: readonly string[];
}) {
  const t = useTranslations('Review');
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [openRow, setOpenRow] = useState<ContextPaneRow | null>(null);

  // The model is pure, so every word it puts on screen arrives from here.
  const labels: ContextPaneLabels = {
    name: t('context_name'),
    title: t('context_title'),
    company: t('context_company'),
    email: t('context_email'),
    stage: t('context_stage'),
    source: t('context_source'),
    since: t('context_since'),
    inbound: t('context_in'),
    outbound: t('context_out'),
    when: t('context_when'),
    system: t('context_system'),
    sequence: t('context_sequence'),
    enrolled: t('context_enrolled'),
    notEnrolled: t('context_not_enrolled'),
    today: t('context_today'),
    proposed: t('context_proposed'),
    contactSection: t('context_contact'),
    threadsSection: t('context_touches'),
    sequenceSection: t('context_sequence'),
    none: t('context_none'),
    notConnected: t('context_not_connected'),
    error: t('context_error'),
    notRead: t('context_not_read'),
  };
  // No `useMemo`: the React Compiler memoizes this, and a hand-written
  // dependency list here cannot name the translator the labels come from
  // without re-running on every render anyway.
  const pane = contextPaneRows({ context, contextRead, changes, evidence, labels, agoLabel: at => agoLabel(at) });

  /**
   * The group eyebrow. Written as literal `t()` calls rather than a lookup so
   * `check:i18n` can see every key that is actually used.
   * @param group - The model's group name.
   */
  const groupLabel = (group: string): string => {
    switch (group) {
      case 'Contact':
        return t('context_contact');
      case 'Threads':
        return t('context_touches');
      case 'Sequence':
        return t('context_sequence');
      case 'Changes':
        return t('context_changes');
      case 'Documents':
        return t('context_documents');
      default:
        return group;
    }
  };
  const shown = filterContextRows(pane.rows, query);
  const groups = groupContextRows(shown);

  const ask = () => {
    const who = context?.contact.status === 'ok' ? (context.contact.data.name ?? context.email) : context?.email;
    openAgentSurface(
      {
        prompt: `What do we know about ${who ?? 'this contact'}${context?.email ? ` (${context.email})` : ''}? Recent emails both ways, the CRM record and how they came in, and any sequence they are in.`,
        context: { path: window.location.pathname, title: document.title, openedFrom: true },
        fallbackContext: context?.email ?? '',
      },
      href => router.push(href),
    );
  };

  if (openRow) {
    return (
      <aside data-testid="review-context" aria-label={t('context_label')} className="lg:sticky lg:top-4">
        <div className="flex min-h-64 flex-col overflow-hidden rounded-lg border border-border" data-testid="review-context-preview">
          <PreviewPane
            key={openRow.id}
            recordRef={openRow.ref ?? { type: 'document', id: openRow.id }}
            {...(openRow.doc ? { doc: openRow.doc } : {})}
            back
            backLabel={t('context_back')}
            compact
            onClose={() => setOpenRow(null)}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside data-testid="review-context" aria-label={t('context_label')} className="text-sm lg:sticky lg:top-4">
      {pane.warnings.length > 0 && (
        <ul data-testid="review-context-warnings" className="mb-3 space-y-2">
          {pane.warnings.map(w => (
            <li key={w} className="flex gap-2 rounded-md border border-brand-amber/40 bg-brand-amber-tint px-3 py-2 text-[13px] text-brand-amber-deep">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {pane.rows.length > 3 && (
        <label className="mb-2 flex items-center gap-2 border-b border-rule pb-2 text-[13px]">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('context_search')}
            aria-label={t('context_search')}
            data-testid="review-context-search"
            className="w-full bg-transparent py-1 outline-none placeholder:text-muted-foreground/70"
          />
        </label>
      )}

      {groups.map(group => (
        <section key={group.group} className="border-t border-rule py-2 first:border-t-0">
          <h3 className="mb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{groupLabel(group.group)}</h3>
          <ul>
            {group.rows.map(row => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setOpenRow(row)}
                  data-testid={`review-context-row-${row.id}`}
                  className="flex min-h-11 w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition hover:bg-[var(--surface-hover,var(--muted))]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{row.title}</span>
                    {row.subline && <span className="block truncate text-[12px] text-muted-foreground">{row.subline}</span>}
                    {row.meta && <span className="block text-[11px] text-muted-foreground tabular-nums">{row.meta}</span>}
                  </span>
                  <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {shown.length === 0 && (query.trim() !== '' || pane.notes.length === 0) && (
        <p className="py-3 text-[13px] text-muted-foreground" data-testid="review-context-empty">
          {query.trim() ? t('context_no_match') : t('context_none')}
        </p>
      )}

      {/* What could not be read, in the system's own words — never an empty
          pane pretending nothing exists (principle 10). */}
      {pane.notes.length > 0 && (
        <ul className="mt-2 border-t border-rule pt-2 text-[12px] text-muted-foreground" data-testid="review-context-notes">
          {pane.notes.map(n => <li key={n}>{n}</li>)}
        </ul>
      )}

      <button
        type="button"
        onClick={ask}
        data-testid="review-context-ask"
        className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-[13px] text-primary transition hover:bg-[var(--surface-hover,var(--muted))]"
      >
        <MessageSquareText className="size-4" aria-hidden />
        {t('context_ask')}
      </button>
    </aside>
  );
}
