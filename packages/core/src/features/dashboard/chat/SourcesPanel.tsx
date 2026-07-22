'use client';

import type { IndexedDocument } from './types';
import { ExternalLink, FileText, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { sourceColors, sourceLabels } from './helpers';

/**
 * Sources panel (Phase C — rev-ai card layout).
 *
 * Right-side collapsible drawer. Lists every document the agent
 * cited or pulled during the current conversation. Click a card to
 * open the document in its source system; click `X` to dismiss the
 * panel.
 *
 * Visual: brand-amber accent on hover, source-color badge per row.
 */

export type SourcesPanelProps = {
  documents: IndexedDocument[];
  open: boolean;
  onClose: () => void;
  /** Citation number (`[n]`) to scroll to + highlight when the panel opens from an inline citation tap. */
  focusCitation?: number | null;
};

export function SourcesPanel({ documents, open, onClose, focusCitation }: SourcesPanelProps) {
  const focusRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (open && focusCitation != null && focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [open, focusCitation]);
  if (!open) {
    return null;
  }
  return (
    <>
      {/* Mobile: dim + tap-to-close backdrop. Desktop: no backdrop, the
          panel is a static side column. */}
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

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {documents.length === 0
          ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                No documents cited yet.
              </div>
            )
          : (
              <ul className="space-y-2">
                {documents.map((doc, i) => {
                  const color = sourceColors[doc.source_type] ?? '#666';
                  const label = sourceLabels[doc.source_type] ?? doc.source_type;
                  const num = doc.citationIndex ?? i + 1;
                  const focused = focusCitation != null && num === focusCitation;
                  return (
                    <li key={`${doc.document_id}-${i}`} ref={focused ? focusRef : undefined}>
                      <a
                        href={doc.link}
                        target="_blank"
                        rel="noreferrer"
                        className={`group flex flex-col gap-2 rounded-lg border bg-background p-3 transition hover:border-brand-amber/40 hover:shadow-sm ${focused ? 'border-brand-amber ring-2 ring-brand-amber/40' : 'border-border'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                            style={{ backgroundColor: `${color}15`, color }}
                          >
                            <FileText className="size-2.5" aria-hidden="true" />
                            {label}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            [
                            {num}
                            ]
                          </span>
                          <ExternalLink
                            className="ml-auto size-3 shrink-0 text-muted-foreground/60 transition group-hover:text-brand-amber-deep"
                            aria-hidden="true"
                          />
                        </div>
                        <div className="text-sm leading-snug font-medium">{doc.semantic_identifier}</div>
                        <div className="line-clamp-2 text-xs text-muted-foreground">{doc.blurb}</div>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
      </div>
    </aside>
    </>
  );
}
