'use client';

import type { IndexedDocument } from './types';
import { ArrowLeft, ExternalLink, FileText, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sourceColors, sourceLabels } from './helpers';

/**
 * Sources drawer — tabbed + two-level.
 *
 * Tabs: "Cited" (the sources the answer actually references via [n]) and "All"
 * (everything the agent retrieved). Tapping an inline [n] opens Cited focused.
 * Tap any card to slide into a detail pane (full excerpt, date, Open-in); Back
 * returns to the list.
 *
 * Mobile: bottom-anchored full-height drawer with a dim backdrop. Desktop:
 * static right-side column. Content wraps — the panel never scrolls sideways.
 */

export type SourcesPanelProps = {
  documents: IndexedDocument[];
  open: boolean;
  onClose: () => void;
  /** Citation number (`[n]`) to scroll to + highlight when opened from an inline tap. */
  focusCitation?: number | null;
  /** Citation numbers actually referenced in the answer(s) — drives the "Cited" tab. */
  citedIndices?: number[];
};

function SourceBadge({ doc }: { doc: IndexedDocument }) {
  const color = sourceColors[doc.source_type] ?? '#666';
  const label = sourceLabels[doc.source_type] ?? doc.source_type;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
      style={{ backgroundColor: `${color}15`, color }}
    >
      <FileText className="size-2.5" aria-hidden="true" />
      {label}
    </span>
  );
}

function formatDate(iso?: string): string | null {
  if (!iso) {
    return null;
  }
  try {
    return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return null;
  }
}

function DetailPane({ doc, num, onBack }: { doc: IndexedDocument; num: number; onBack: () => void }) {
  const date = formatDate(doc.updated_at);
  return (
    <div className="flex h-full w-full flex-col overflow-x-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Back to sources"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>
        <span className="ml-auto text-[10px] text-muted-foreground">
          [
          {num}
          ]
        </span>
      </div>
      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4">
        <SourceBadge doc={doc} />
        <h3 className="mt-2 text-base leading-snug font-semibold break-words hyphens-auto">{doc.semantic_identifier}</h3>
        {date && <div className="mt-1 text-xs text-muted-foreground">{date}</div>}
        <p className="mt-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-foreground/80">{doc.blurb}</p>
      </div>
      {doc.link && (
        <div className="border-t border-border p-3">
          <a
            href={doc.link}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-amber px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-amber-deep"
          >
            <span className="truncate">
              Open in
              {' '}
              {sourceLabels[doc.source_type] ?? doc.source_type}
            </span>
            <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}

export function SourcesPanel({ documents, open, onClose, focusCitation, citedIndices }: SourcesPanelProps) {
  const focusRef = useRef<HTMLLIElement | null>(null);
  const [selected, setSelected] = useState<{ doc: IndexedDocument; num: number } | null>(null);

  const citedSet = new Set(citedIndices ?? []);
  const cited = citedSet.size > 0 ? documents.filter(d => d.citationIndex != null && citedSet.has(d.citationIndex)) : [];
  const showTabs = cited.length > 0 && cited.length < documents.length;
  const [tab, setTab] = useState<'cited' | 'all'>('all');
  // Default to Cited when the drawer opens (or a citation is tapped) if there's a split.
  useEffect(() => {
    setTab(showTabs ? 'cited' : 'all');
    setSelected(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusCitation]);

  const visible = tab === 'cited' && showTabs ? cited : documents;

  useEffect(() => {
    if (open && !selected && focusCitation != null && focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [open, focusCitation, selected, tab]);

  if (!open) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        aria-label="Close sources"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 sm:hidden"
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[85vw] max-w-sm shrink-0 flex-col overflow-x-hidden border-l border-border bg-background shadow-xl sm:static sm:z-auto sm:w-96 sm:max-w-none sm:shadow-none">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Sources
            </div>
            <div className="text-sm font-medium">
              {documents.length}
              {' '}
              document
              {documents.length === 1 ? '' : 's'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close sources panel"
          >
            <X className="size-4" />
          </button>
        </header>

        {showTabs && !selected && (
          <div className="flex gap-1 border-b border-border px-3 py-2">
            {([['cited', `Cited (${cited.length})`], ['all', `All (${documents.length})`]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${tab === key ? 'bg-brand-amber/15 text-brand-amber-deep' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Two-level track: list + detail slide-over. */}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div className="h-full overflow-x-hidden overflow-y-auto px-4 py-4">
            {visible.length === 0
              ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                    No sources here yet.
                  </div>
                )
              : (
                  <ul className="space-y-2">
                    {visible.map((doc, i) => {
                      const num = doc.citationIndex ?? i + 1;
                      const focused = focusCitation != null && num === focusCitation;
                      return (
                        <li key={`${doc.document_id}-${num}-${i}`} ref={focused ? focusRef : undefined} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setSelected({ doc, num })}
                            className={`group flex w-full min-w-0 flex-col gap-2 rounded-lg border bg-background p-3 text-left transition hover:border-brand-amber/40 hover:shadow-sm ${focused ? 'border-brand-amber ring-2 ring-brand-amber/40' : 'border-border'}`}
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <SourceBadge doc={doc} />
                              <span className="text-[10px] text-muted-foreground">
                                [
                                {num}
                                ]
                              </span>
                              {doc.foundBy && (
                                <span className="truncate rounded-full bg-brand-amber/10 px-1.5 py-0.5 text-[9px] font-medium text-brand-amber-deep">
                                  via
                                  {' '}
                                  {doc.foundBy}
                                </span>
                              )}
                              <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground/70 transition group-hover:text-brand-amber-deep">Details →</span>
                            </div>
                            <div className="min-w-0 text-sm leading-snug font-medium break-words">{doc.semantic_identifier}</div>
                            <div className="line-clamp-2 min-w-0 text-xs break-words text-muted-foreground">{doc.blurb}</div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
          </div>

          <div
            className={`absolute inset-0 min-w-0 overflow-x-hidden bg-background transition-transform duration-200 ease-out ${selected ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}
            aria-hidden={!selected}
          >
            {selected && <DetailPane doc={selected.doc} num={selected.num} onBack={() => setSelected(null)} />}
          </div>
        </div>
      </aside>
    </>
  );
}
