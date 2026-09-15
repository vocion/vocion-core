'use client';

import type { PageContext } from '@/services/chat/pageContext';
import { ArrowUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { recordRef } from '@/services/chat/recordContext';
import { AskAboutThis } from './context/AskAboutThis';

// Re-exported so existing importers keep working; the chat page reads the same key.
export { CHAT_HANDOFF_KEY, type ChatHandoff } from '@/features/dashboard/chat/agentSurface';

/**
 * Floating composer at the bottom of the Briefings page. Typing here opens
 * the agent surface with the question (R4): a mounted dock claims it and the
 * turn is filed with the briefing as its record; with no surface on the page
 * the person lands on /chat with the same intent, the briefing body riding
 * along as fallback context — the pre-R4 behaviour, kept.
 *
 * Highlighting text inside [data-briefing-root] pops an "Ask Vocion" pill
 * (shared `AskAboutThis` selection watcher) — clicking it pins the selection
 * to this composer as a quoted excerpt, so the question targets that passage.
 * @param props
 * @param props.briefingId
 * @param props.briefingTitle
 * @param props.briefingContent
 * @param props.agentSlug
 */
export const BriefingChatStarter = (props: { briefingId: number; briefingTitle: string; briefingContent: string; agentSlug?: string }) => {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState('');
  const [quote, setQuote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Portal target only exists client-side; render nothing during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const record = recordRef('briefing', props.briefingId, props.briefingTitle);

  // The selection pill pins the passage HERE rather than opening the surface
  // straight away, so the person can type the question about it first.
  useEffect(() => {
    const onPin = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (text) {
        setQuote(text);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('vocion:briefing-pin-quote', onPin);
    return () => window.removeEventListener('vocion:briefing-pin-quote', onPin);
  }, []);

  const start = () => {
    const question = value.trim();
    if (!question) {
      return;
    }
    const context: PageContext = {
      path: pathname,
      title: props.briefingTitle,
      record,
      openedFrom: true,
      ...(quote ? { selection: { text: quote, quote: true } } : {}),
    };
    openAgentSurface(
      { prompt: question, send: true, context, agentSlug: props.agentSlug, fallbackContext: props.briefingContent },
      href => router.push(href),
    );
    setValue('');
    setQuote(null);
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
      <PinSelection />
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
          {/* Same composer language as /chat (rounded-2xl card, amber focus
              ring, round amber ArrowUp) so starting a chat here FEELS like
              already being in the chat. */}
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-4 py-3 shadow-lg transition focus-within:border-brand-amber focus-within:shadow-[0_8px_28px_rgba(241,135,0,0.10)] focus-within:ring-4 focus-within:ring-brand-amber-tint">
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
              placeholder={quote ? 'Ask about the highlighted passage…' : 'Ask about this brief — the team lead answers beside it…'}
              className="min-w-0 flex-1 bg-transparent text-base leading-relaxed outline-none placeholder:text-muted-foreground/70 sm:text-sm"
            />
            <button
              type="button"
              onClick={start}
              disabled={!value.trim()}
              aria-label="Start chat"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-amber text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-brand-amber-deep disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground/50 disabled:shadow-none disabled:hover:translate-y-0 sm:size-9"
            >
              <ArrowUp className="size-5 sm:size-[18px]" />
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );

  /**
   * The shared selection watcher, wired to PIN into this composer instead of
   * opening the surface — `AskAboutThis` fires the surface itself, so we
   * intercept its pill through a tiny local event instead.
   */
  function PinSelection() {
    return (
      <AskAboutThis
        record={record}
        variant="none"
        selectionRoot="[data-briefing-root]"
        agentSlug={props.agentSlug}
        fallbackContext={props.briefingContent}
        onSelect={text => window.dispatchEvent(new CustomEvent('vocion:briefing-pin-quote', { detail: { text } }))}
      />
    );
  }
};
