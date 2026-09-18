'use client';

import type { PreviewDoc } from '@/libs/preview/types';
import type { RecordRef } from '@/services/chat/pageContext';
import { ArrowLeft, ExternalLink, MessageSquareText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { Link, useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { closePreview } from './previewState';

/**
 * The preview PANE — the content, with no geometry of its own.
 *
 * Geometry belongs to the column (`features/dashboard/chat/RailColumn`), which
 * is the only thing that knows whether it is sharing the column with chat,
 * how tall each pane is, and whether it is a sheet on a small screen. This
 * file is the anatomy and nothing else:
 *
 *   header   the source chip and the link out
 *   body     what we hold
 *
 * A preview never carries actions that belong to the detail page — it answers
 * "is this the right thing, and what does it say", and the link is how you
 * make it the task.
 *
 * It renders no `Section`, deliberately. `Section` is a commentable region
 * (`patterns/DetailPage`), and a comment anchored in a peek would be filed
 * against the page you are standing on rather than the record you are
 * reading — so a selection inside a preview raises nothing, and the way to
 * talk about what you found is the link out.
 *
 * It never takes focus, which is what separates a peek from a dialog: Escape
 * closes it and hands focus back to whatever opened it, and the page's own
 * shortcuts keep working while it is open.
 */

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

/**
 * @param props
 * @param props.recordRef - What to show.
 * @param props.back - On a small screen the column is a sheet, so the preview
 * replaces its content rather than splitting it in two; the close control
 * becomes "back to chat" and says so.
 */
export function PreviewPane(props: { recordRef: Pick<RecordRef, 'type' | 'id'>; back?: boolean }) {
  const { recordRef } = props;
  const [doc, setDoc] = useState<PreviewDoc | null>(null);
  const [failed, setFailed] = useState(false);

  // The pane is keyed on the ref by its parent, so a new reference remounts it
  // and the loading state is the initial state — no reset needed here.
  useEffect(() => {
    let live = true;
    client.preview.get({ type: recordRef.type, id: recordRef.id })
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
  }, [recordRef.type, recordRef.id]);

  const shown: PreviewDoc = doc ?? {
    ref: { type: recordRef.type, id: recordRef.id },
    title: failed ? 'Could not load this reference' : 'Loading…',
    sourceLabel: 'Preview',
    ...(failed ? { unresolved: { reason: 'The preview did not load. The reference is below.', reference: recordRef.id } } : {}),
  };

  const CloseIcon = props.back ? ArrowLeft : X;
  const router = useRouter();
  // "Chat about this" — the ONE entry function (§6): a rail on this page
  // opens about the record; a page with no surface goes to the chat page
  // with the record as the handoff. The peek closes either way: the
  // conversation is the place to keep looking at it.
  const discuss = () => {
    const record: RecordRef = { type: recordRef.type, id: recordRef.id, label: shown.title, ...(shown.href ? { href: shown.href } : {}) };
    closePreview();
    openAgentSurface(
      {
        context: { path: window.location.pathname, title: document.title, record, openedFrom: true },
        fallbackContext: shown.title,
      },
      href => router.push(href),
    );
  };

  return (
    <section
      data-testid="preview-panel"
      data-preview-key={`${recordRef.type}:${recordRef.id}`}
      aria-label={`Preview: ${shown.title}`}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background"
    >
      <header className="sticky top-0 flex items-start gap-2 border-b border-border bg-background px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Chip>{shown.sourceLabel}</Chip>
            {shown.href
              ? (
                  <Link href={shown.href} onClick={closePreview} data-testid="preview-detail-link" className="truncate text-[12px] underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground">
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
          onClick={discuss}
          data-testid="preview-discuss"
          aria-label={`Chat about ${shown.title}`}
          title="Chat about this"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-surface-soft hover:text-foreground"
        >
          <MessageSquareText className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={closePreview}
          data-testid="preview-close"
          aria-label={props.back ? 'Back to chat' : 'Close preview'}
          className="-mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-surface-soft hover:text-foreground"
        >
          <CloseIcon className="size-4" aria-hidden />
        </button>
      </header>
      <Body doc={shown} />
    </section>
  );
}
