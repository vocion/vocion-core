'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import { evidenceRef } from '@/libs/preview/evidenceRef';
import { previewKey } from '@/libs/preview/types';
import { cn } from '@/utils/Helpers';
import { PreviewPanel } from './PreviewPanel';
import { useOpenPreviewRef, usePreviewOpener } from './previewState';

/**
 * Evidence you can open.
 *
 * The first consumer of the preview capability, and deliberately a thin one:
 * it turns each citation into a `RecordRef` and hands it to the shared panel.
 * Everything that makes the peek work — resolving, the panel, the keyboard
 * contract, one-at-a-time — lives in the capability, so the ask sheet, the
 * lead brief and the briefing claims each get it by rendering this.
 *
 * No item ever reads as a bare id. A citation whose tail is a handle shows its
 * kind until the resolver answers with the real title; the handle lives behind
 * the preview, which is where a handle belongs.
 */

/**
 * One citation, as a button that previews it.
 * @param props
 * @param props.source - The citation string as it was recorded.
 * @param props.className
 */
export function EvidenceRef(props: { source: string; className?: string }) {
  const item = evidenceRef(props.source);
  const open = usePreviewOpener(item.ref);
  const active = useOpenPreviewRef();
  const isOpen = active !== null && previewKey(active) === previewKey(item.ref);
  return (
    <button
      type="button"
      onClick={open}
      data-testid="evidence-ref"
      data-preview-key={previewKey(item.ref)}
      aria-expanded={isOpen}
      className={cn(
        'flex w-full items-center gap-2 rounded px-1 py-1.5 text-left text-sm hover:bg-surface-soft',
        isOpen && 'bg-surface-soft',
        props.className,
      )}
    >
      <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-surface-soft px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {item.sourceLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
    </button>
  );
}

/**
 * A list of citations, each openable, with the panel beside it.
 * @param props
 * @param props.sources
 * @param props.empty
 * @param props.className
 */
export function EvidenceRefs(props: { sources: readonly string[]; empty?: string; className?: string }) {
  if (props.sources.length === 0) {
    return props.empty ? <p className="text-sm text-muted-foreground">{props.empty}</p> : null;
  }
  return (
    <>
      <ul data-testid="evidence-refs" className={cn('divide-y divide-rule', props.className)}>
        {props.sources.map((source, i) => (
          <li key={`${source}-${i}`}>
            <EvidenceRef source={source} />
          </li>
        ))}
      </ul>
      <PreviewPanel />
    </>
  );
}

/**
 * A ref that is already typed — an `@` mention, a search hit, a CRM subject.
 * @param props
 * @param props.recordRef
 * @param props.label
 * @param props.className
 */
export function PreviewRef(props: { recordRef: RecordRef; label?: string; className?: string }) {
  const open = usePreviewOpener(props.recordRef);
  const active = useOpenPreviewRef();
  const isOpen = active !== null && previewKey(active) === previewKey(props.recordRef);
  return (
    <>
      <button
        type="button"
        onClick={open}
        data-testid="preview-ref"
        data-preview-key={previewKey(props.recordRef)}
        aria-expanded={isOpen}
        className={cn('rounded px-1 text-left underline decoration-border underline-offset-2 hover:decoration-foreground', isOpen && 'bg-surface-soft', props.className)}
      >
        {props.label ?? props.recordRef.label ?? props.recordRef.id}
      </button>
      <PreviewPanel />
    </>
  );
}
