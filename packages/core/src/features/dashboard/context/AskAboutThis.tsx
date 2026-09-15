'use client';

import type { PageContext, RecordRef } from '@/services/chat/pageContext';
import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { useSelectionWatcher } from './useSelectionWatcher';

/**
 * The generic "Ask about this" affordance (R4). Two things in one component:
 *
 *  - a small button that opens the agent surface with this record as context
 *    (and, optionally, a prompt — "Do this: …" for a briefing bullet);
 *  - when `selectionRoot` is given, a floating "Ask Vocion" pill that appears
 *    over text the person highlights inside that root, and opens the surface
 *    with the passage quoted.
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
 * @param props.onSelect - When given, the selection pill hands the highlighted text to the caller instead of opening the surface.
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

  const open = useCallback((extra?: { selection?: string; prompt?: string; send?: boolean }) => {
    const context: PageContext = {
      path: pathname,
      title: typeof document !== 'undefined' ? document.title : '',
      record: props.record,
      openedFrom: true,
      ...(extra?.selection ? { selection: { text: extra.selection, quote: true } } : {}),
    };
    openAgentSurface(
      {
        prompt: extra?.prompt ?? props.prompt,
        send: extra?.send ?? props.send,
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
        <div className="fixed z-50 -translate-x-1/2 -translate-y-full" style={{ left: hit.x, top: hit.y - 8 }}>
          <button
            type="button"
            // mousedown, not click — click would collapse the selection first.
            onMouseDown={(e) => {
              e.preventDefault();
              const text = hit.text;
              clearHit();
              if (props.onSelect) {
                props.onSelect(text);
                return;
              }
              open({ selection: text, prompt: props.prompt ?? '' });
            }}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-lg transition hover:bg-muted"
          >
            <Sparkles className="size-3.5 text-primary" aria-hidden />
            Ask Vocion
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
