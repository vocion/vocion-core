'use client';

import type { IndexedDocument } from './types';
import { ArrowLeft, ExternalLink, FileText, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sourceColors, sourceLabels } from './helpers';

/**
 * Sources panel — a two-level drawer.
 *
 * Level 1: the list of every document the agent cited/pulled this turn,
 * numbered to match the inline [n] citation markers.
 * Level 2: tap a card to slide to a detail pane — full excerpt, source +
 * date metadata, and "Open in <source>". Back returns to the list.
 *
 * Mobile: bottom-anchored full-height drawer with a dim backdrop. Desktop:
 * static right-side column.
 */

export type SourcesPanelProps = {
  documents: IndexedDocument[];
  open: boolean;
  onClose: () => void;
  /** Citation number (`[n]`) to scroll to + highlight when the panel opens from an inline citation tap. */
  focusCitation?: number | null;
};

function SourceBadge({ doc }: { doc: IndexedDocument }) {
  const color = sourceColors[doc.source_type] ?? '#666';
  const label = sourceLabels[doc.source_type] ?? doc.source_type;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
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
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Back to sources"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Sources
        </button>
        <span className="ml-auto text-[10px] text-muted-foreground">
          [
          {num}
          ]
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <SourceBadge doc={doc} />
        <h3 className="mt-2 text-base leading-snug font-semibold">{doc.semantic_identifier}</h3>
        {date && <div className="mt-1 text-xs text-muted-foreground">{date}</div>}
        <p className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/80">{doc.blurb}</p>
      </div>
      {doc.link && (
        <div className="border-t border-border p-3">
          <a
            href={doc.link}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-amber px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-amber-deep"
          >
            Open in
            {' '}
            {sourceLabels[doc.source_type] ?? doc.source_type}
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}

export function SourcesPanel({ documents, open, onClose, focusCitation }: SourcesPanelProps) {
  const focusRef = useRef<HTMLLIElement | null>(null);
  const [selected, setSelected] = useState<{ doc: IndexedDocument; num: number } | null>(null);

  // Reset to the list whenever the drawer (re)opens or a new citation is tapped.
  useEffect(() => {
    setSelected(null);
  }, [open, focusCitation]);

  useEffect(() => {
    if (open && !selected && focusCitation != null && focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [open, focusCitation, selected]);

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
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[85vw] max-w-sm shrink-0 flex-col border-l border-border bg-background shadow-xl sm:static sm:z-auto sm:w-96 sm:max-w-none sm:shadow-none">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
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
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close sources panel"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* Two-level track: list + detail slide-over. */}
        <div className="relative flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto px-4 py-4">
            {documents.length === 0
              ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                    No documents cited yet.
                  </div>
                )
              : (
                  <ul className="space-y-2">
                    {documents.map((doc, i) => {
                      const num = doc.citationIndex ?? i + 1;
                      const focused = focusCitation != null && num === focusCitation;
                      return (
                        <li key={`${doc.document_id}-${i}`} ref={focused ? focusRef : undefined}>
                          <button
                            type="button"
                            onClick={() => setSelected({ doc, num })}
                            className={`group flex w-full flex-col gap-2 rounded-lg border bg-background p-3 text-left transition hover:border-brand-amber/40 hover:shadow-sm ${focused ? 'border-brand-amber ring-2 ring-brand-amber/40' : 'border-border'}`}
                          >
                            <div className="flex items-center gap-2">
                              <SourceBadge doc={doc} />
                              <span className="text-[10px] text-muted-foreground">
                                [
                                {num}
                                ]
                              </span>
                              <span className="ml-auto text-[10px] font-medium text-muted-foreground/70 transition group-hover:text-brand-amber-deep">Details →</span>
                            </div>
                            <div className="text-sm leading-snug font-medium">{doc.semantic_identifier}</div>
                            <div className="line-clamp-2 text-xs text-muted-foreground">{doc.blurb}</div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
          </div>

          <div
            className={`absolute inset-0 bg-background transition-transform duration-200 ease-out ${selected ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}
            aria-hidden={!selected}
          >
            {selected && <DetailPane doc={selected.doc} num={selected.num} onBack={() => setSelected(null)} />}
          </div>
        </div>
      </aside>
    </>
  );
}
