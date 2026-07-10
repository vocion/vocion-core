'use client';

import { MessageSquare, Send, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from '@/libs/I18nNavigation';

/** sessionStorage key ChatShell reads on mount to start a handoff chat. */
export const CHAT_HANDOFF_KEY = 'vocion_chat_handoff';

export type ChatHandoff = {
  question: string;
  contextTitle: string;
  context: string;
  /** Optional highlighted excerpt the question is specifically about. */
  excerpt?: string;
};

/**
 * Floating composer at the bottom of the Briefings page. Typing here moves
 * the conversation to /chat: the briefing rides along as context, a new
 * chat opens against the team lead, and the question is answered there.
 *
 * Highlighting text inside [data-briefing-root] pops an "Ask Vocion"
 * tooltip — clicking it pins the selection to the pill as a quoted
 * excerpt, so the question targets that passage specifically.
 * @param props
 * @param props.briefingTitle
 * @param props.briefingContent
 */
export const BriefingChatStarter = (props: { briefingTitle: string; briefingContent: string }) => {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [quote, setQuote] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Portal target only exists client-side; render nothing during SSR.
  // (useSyncExternalStore-style mount detection keeps the linter happy —
  // no setState-in-effect.)
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Selection watcher — show the tooltip when a selection lands inside the
  // briefing content ([data-briefing-root]).
  useEffect(() => {
    const onMouseUp = () => {
      // Let the browser finalize the selection first.
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? '';
        if (!sel || sel.isCollapsed || text.length < 4) {
          setTooltip(null);
          return;
        }
        const anchor = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
        if (!anchor?.closest('[data-briefing-root]')) {
          setTooltip(null);
          return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setTooltip({ x: rect.left + rect.width / 2, y: rect.top, text });
      });
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  const pinQuote = useCallback(() => {
    if (tooltip) {
      setQuote(tooltip.text);
      setTooltip(null);
      window.getSelection()?.removeAllRanges();
      inputRef.current?.focus();
    }
  }, [tooltip]);

  const start = () => {
    const question = value.trim();
    if (!question) {
      return;
    }
    const handoff: ChatHandoff = {
      question,
      contextTitle: props.briefingTitle,
      context: props.briefingContent,
      excerpt: quote ?? undefined,
    };
    sessionStorage.setItem(CHAT_HANDOFF_KEY, JSON.stringify(handoff));
    router.push('/dashboard/chat');
  };

  if (!mounted) {
    return null;
  }

  // Portal to <body>: the dashboard layout wraps pages in a `@container`
  // div, and CSS container-type implies layout containment — which turns
  // `position: fixed` into container-relative positioning. Escaping to
  // the body keeps the pill pinned to the real viewport.
  return createPortal(
    <>
      {tooltip && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: tooltip.x, top: tooltip.y - 8 }}
        >
          <button
            type="button"
            // mousedown, not click — click would collapse the selection first.
            onMouseDown={(e) => {
              e.preventDefault();
              pinQuote();
            }}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-lg transition hover:bg-muted"
          >
            <Sparkles className="size-3.5 text-primary" />
            Ask Vocion
          </button>
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-6">
        <div className="pointer-events-auto w-full max-w-2xl">
          {quote && (
            <div className="mx-4 mb-1 flex items-start gap-2 rounded-t-xl border border-b-0 border-border bg-muted/60 px-4 py-2 backdrop-blur">
              <span className="line-clamp-2 min-w-0 flex-1 text-xs text-muted-foreground italic">
                “
                {quote}
                ”
              </span>
              <button type="button" onClick={() => setQuote(null)} aria-label="Remove quote" className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 shadow-lg">
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  start();
                }
              }}
              placeholder={quote ? 'Ask about the highlighted passage…' : 'Ask about this briefing — opens a chat with the team lead…'}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={start}
              disabled={!value.trim()}
              aria-label="Start chat"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};
