'use client';

import type { PreviewDoc } from '@/libs/preview/types';
import type { RecordRef } from '@/services/chat/pageContext';
import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';
import { closePreview, useEscapeToClose, useOpenPreviewRef, usePreviewHost } from './previewState';

/**
 * The preview panel — one surface, one contract, for every record type.
 *
 * Anatomy, and nothing else: a header carrying the source chip and the link
 * out, then the body. A preview never carries actions that belong to the
 * detail page — it answers "is this the right thing, and what does it say",
 * and the link is how you make it the task.
 *
 * It takes the right rail's slot and stacks over it rather than opening a
 * third column. The rail keeps its own state underneath and comes back when
 * the preview closes, so "one thing on the right at a time" holds without the
 * two features having to know about each other.
 *
 * It never takes focus. Escape closes it and hands focus back to whatever
 * opened it, and while it is open the page's own shortcuts still work — a
 * reviewer can approve with `a` while reading the evidence they are approving
 * on. That is the difference between a peek and a dialog.
 *
 * Render it anywhere; only the first mounted host paints.
 */

const WIDTH = 'w-[min(32rem,100vw)] sm:w-[max(24rem,33.333vw)]';

function Chip(props: { children: string }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-surface-soft px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
      {props.children}
    </span>
  );
}

function Body(props: { doc: PreviewDoc }) {
  const { doc } = props;
  if (doc.unresolved) {
    return (
      <div className="px-4 py-3">
        <p className="text-sm text-muted-foreground">{doc.unresolved.reason}</p>
        <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Reference</p>
        <p className="mt-1 font-mono text-[12px] break-all text-foreground">{doc.unresolved.reference}</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      {doc.subtitle && <p className="mb-3 text-sm leading-relaxed text-foreground">{doc.subtitle}</p>}
      {doc.facts && doc.facts.length > 0 && (
        <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          {doc.facts.map(f => (
            <div key={f.label} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="min-w-0 break-words text-foreground">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {doc.body
        ? (
            <div className="prose prose-sm max-w-none border-t border-rule pt-3 dark:prose-invert">
              <Markdown remarkPlugins={[remarkGfm]}>{doc.body}</Markdown>
            </div>
          )
        : <p className="border-t border-rule pt-3 text-sm text-muted-foreground">No text was synced for this reference.</p>}
      {doc.truncated && <p className="mt-3 text-xs text-muted-foreground">Cut short — open the full page for the rest.</p>}
    </div>
  );
}

function Panel(props: { ref_: Pick<RecordRef, 'type' | 'id'> }) {
  const { ref_ } = props;
  const [doc, setDoc] = useState<PreviewDoc | null>(null);
  const [failed, setFailed] = useState(false);

  // The panel is keyed on the ref, so a new reference remounts it and the
  // loading state is the initial state — no reset needed here.
  useEffect(() => {
    let live = true;
    client.preview.get({ type: ref_.type, id: ref_.id })
      .then((d) => {
        if (live) {
          setDoc(d as PreviewDoc);
        }
      })
      .catch(() => {
        if (live) {
          setFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [ref_.type, ref_.id]);

  const shown: PreviewDoc = doc ?? {
    ref: { type: ref_.type, id: ref_.id },
    title: failed ? 'Could not load this reference' : 'Loading…',
    sourceLabel: 'Preview',
    ...(failed ? { unresolved: { reason: 'The preview did not load. The reference is below.', reference: ref_.id } } : {}),
  };

  return (
    <aside
      data-testid="preview-panel"
      data-preview-key={`${ref_.type}:${ref_.id}`}
      aria-label={`Preview: ${shown.title}`}
      className={cn('fixed top-16 right-0 bottom-0 z-50 flex flex-col overflow-y-auto border-l border-border bg-background shadow-lg', WIDTH)}
    >
      <header className="sticky top-0 flex items-start gap-2 border-b border-border bg-background px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Chip>{shown.sourceLabel}</Chip>
            {shown.href
              ? (
                  <Link href={shown.href} data-testid="preview-detail-link" className="truncate text-[12px] underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground">
                    Open full page
                  </Link>
                )
              : shown.externalHref
                ? (
                    <a href={shown.externalHref} target="_blank" rel="noopener noreferrer" data-testid="preview-external-link" className="inline-flex items-center gap-1 truncate text-[12px] underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground">
                      Open in
                      {' '}
                      {shown.sourceLabel}
                      <ExternalLink className="size-3" aria-hidden />
                      <span className="sr-only">(leaves Vocion)</span>
                    </a>
                  )
                : null}
          </div>
          <h2 className="mt-1 text-sm font-semibold break-words text-foreground">{shown.title}</h2>
        </div>
        <button
          type="button"
          onClick={closePreview}
          data-testid="preview-close"
          aria-label="Close preview"
          className="-mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-surface-soft hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <Body doc={shown} />
    </aside>
  );
}

export function PreviewPanel() {
  const ref_ = useOpenPreviewRef();
  const host = usePreviewHost();
  useEscapeToClose(host && ref_ !== null);
  if (!host || !ref_) {
    return null;
  }
  return <Panel key={`${ref_.type}:${ref_.id}`} ref_={ref_} />;
}
