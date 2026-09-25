'use client';

import type { ContextRef } from '@/features/dashboard/chat/types';
import type { PageContext, RecordRef } from '@/services/chat/pageContext';
import { MessageSquareText, Pencil, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { changeRef } from '@/features/dashboard/chat/composerTags';
import { SelectionToolbar } from '@/features/dashboard/chat/SelectionToolbar';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { useSelectionWatcher } from './useSelectionWatcher';

/**
 * The generic "Ask about this" affordance (R4). Two things in one component:
 *
 *  - a small button that opens the agent surface with this record as context
 *    (and, optionally, a prompt — "Do this: …" for a briefing bullet);
 *  - when `selectionRoot` is given, the floating selection toolbar
 *    (`SelectionToolbar`, the same one the document frame and the transcript
 *    show) over text the person highlights inside that root: **Ask** opens the
 *    surface with the passage quoted; **Change**, offered when `changeable`,
 *    is Ask with the instruction pre-typed — "Change this: " — so "cut this"
 *    or "make this about Q4" is one click plus the words, and the agent edits
 *    the record through its write tool.
 *
 * Wherever the person is, the same call: a mounted dock claims it and
 * prefills; otherwise the person lands on the full-page chat with the same
 * intent. Nothing here sends unless `send` is set.
 * @param props
 * @param props.record - The record the ask is about.
 * @param props.prompt - Composer prefill; default is empty (just open with context).
 * @param props.send - Send the prompt at once (used by "Do this").
 * @param props.label - Button text; default "Ask about this".
 * @param props.agentSlug - Preferred agent (a team lead).
 * @param props.selectionRoot - CSS selector to watch for highlighted text.
 * @param props.fallbackContext - Long text for the no-surface fallback (e.g. the briefing body).
 * @param props.variant - 'button' (default) renders the pill button; 'icon' a compact icon-only control; 'none' only the selection watcher.
 * @param props.onSelect - When given, the selection toolbar's Ask hands the highlighted text to the caller instead of opening the surface.
 * @param props.changeable - Offer "Change" beside "Ask" on a selection: the record can be edited in place by the agent.
 * @param props.className
 */
export function AskAboutThis(props: {
  record: RecordRef;
  prompt?: string;
  send?: boolean;
  label?: string;
  agentSlug?: string;
  selectionRoot?: string;
  fallbackContext?: string;
  variant?: 'button' | 'icon' | 'none';
  onSelect?: (text: string) => void;
  changeable?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [hit, clearHit] = useSelectionWatcher(props.selectionRoot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const open = useCallback((extra?: { selection?: string; prompt?: string; send?: boolean; tags?: ContextRef[] }) => {
    const context: PageContext = {
      path: pathname,
      title: typeof document !== 'undefined' ? document.title : '',
      record: props.record,
      openedFrom: true,
      ...(extra?.selection ? { selection: { text: extra.selection, quote: true } } : {}),
    };
    // NEVER paste human text into the composer (Chris, 2026-09-24): a prompt
    // is carried only when it is SENT as an action ("Draft"); otherwise the
    // record and the selection ride as typed context and the person types.
    const send = extra?.send ?? props.send;
    const prompt = extra?.prompt ?? props.prompt;
    openAgentSurface(
      {
        prompt: send ? prompt : undefined,
        send,
        tags: extra?.tags,
        context,
        agentSlug: props.agentSlug,
        fallbackContext: props.fallbackContext,
      },
      href => router.push(href),
    );
  }, [pathname, props.record, props.prompt, props.send, props.agentSlug, props.fallbackContext, router]);

  const label = props.label ?? 'Ask about this';
  const variant = props.variant ?? 'button';

  return (
    <>
      {variant === 'button' && (
        <button
          type="button"
          onClick={() => open()}
          data-ask-about-this={props.record.type}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-brand-amber/50 hover:text-foreground ${props.className ?? ''}`}
        >
          <Sparkles className="size-3.5 text-brand-amber" aria-hidden />
          {label}
        </button>
      )}
      {variant === 'icon' && (
        <button
          type="button"
          onClick={() => open()}
          data-ask-about-this={props.record.type}
          aria-label={label}
          title={label}
          className={`inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground ${props.className ?? ''}`}
        >
          <Sparkles className="size-3.5" aria-hidden />
        </button>
      )}
      {mounted && hit && createPortal(
        // The toolbar positions itself in its container's coordinates; a
        // zero-height fixed strip across the viewport makes those the
        // viewport's, which is what the selection watcher measured.
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0 [&>*]:pointer-events-auto">
          <SelectionToolbar
            x={hit.x}
            y={hit.y}
            width={window.innerWidth}
            testId={props.record.type}
            actions={[
              {
                label: 'Ask',
                icon: MessageSquareText,
                onClick: () => {
                  const text = hit.text;
                  clearHit();
                  if (props.onSelect) {
                    props.onSelect(text);
                    return;
                  }
                  open({ selection: text });
                },
              },
              ...(props.changeable
                ? [{
                    label: 'Change',
                    icon: Pencil,
                    onClick: () => {
                      const text = hit.text;
                      clearHit();
                      open({ selection: text, tags: [changeRef()] });
                    },
                  }]
                : []),
            ]}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
