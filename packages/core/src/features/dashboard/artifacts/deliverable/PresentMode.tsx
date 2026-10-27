'use client';

/**
 * Present: the deck full screen, one slide at a time. Arrow keys, space and
 * Page Up/Down move; Home/End jump; a click on the slide moves on (its left
 * third goes back); Escape leaves. "Open notes" opens a second window with the
 * current slide's notes and the next slide, kept in step over a
 * `BroadcastChannel` (`presenterNotes.ts`) — it can move the deck too.
 * Nothing animates, so reduced motion is already respected.
 *
 * The same view fills a browser window of its own (`display="window"`, the
 * deck's `/window` route): nothing goes full screen until the person asks with
 * the Full screen button, leaving full screen keeps the window, and there is
 * no Exit — the window's own close is the way out. One slide view, two places
 * to show it (design principle 6).
 */

import type { DeliverablePage } from './pages';
import type { PresenterMessage, PresenterState } from './presenterNotes';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, NotebookText, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '@/libs/decks/page';
import { PageFrame } from './PageFrame';
import { presenterChannel, presenterNotesHtml } from './presenterNotes';

export type PresentModeProps = {
  artifactId: number;
  title: string;
  pages: DeliverablePage[];
  frameHtml: (key: string) => string;
  /** The slide to start on (the one selected in the pane). */
  start: number;
  /** Where the presenter is, so the pane follows. */
  onIndex?: (index: number) => void;
  /** Leave present mode. The window display has none: closing the window is the way out. */
  onClose?: () => void;
  /**
   * `overlay` (default): over the pane, full screen at once, and leaving full
   * screen leaves present mode. `window`: the deck's own browser window, full
   * screen only when asked.
   */
  display?: 'overlay' | 'window';
};

const CONTROL = 'inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

export function PresentMode(props: PresentModeProps) {
  const t = useTranslations('Deliverable');
  const [index, setIndex] = useState(Math.max(0, Math.min(props.start, props.pages.length - 1)));
  const rootRef = useRef<HTMLDivElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const page = props.pages[index];
  const { pages, frameHtml } = props;
  const windowed = props.display === 'window';
  const [fullscreen, setFullscreen] = useState(false);
  // The caller's callbacks are fresh on every render (moving a slide re-renders
  // the pane through `onIndex`). Read them through refs so the full-screen
  // effect below runs once: re-running it exits full screen, and the browser
  // refuses to re-enter without a click.
  const onCloseRef = useRef(props.onClose);
  const onIndexRef = useRef(props.onIndex);
  useEffect(() => {
    onCloseRef.current = props.onClose;
    onIndexRef.current = props.onIndex;
  });
  const onClose = useCallback(() => onCloseRef.current?.(), []);

  const go = useCallback((to: number | 'next' | 'prev') => {
    setIndex((i) => {
      const next = to === 'next' ? i + 1 : to === 'prev' ? i - 1 : to;
      return Math.max(0, Math.min(pages.length - 1, next));
    });
  }, [pages.length]);

  useEffect(() => {
    onIndexRef.current?.(index);
  }, [index]);

  const state = useCallback((): PresenterState => {
    const cur = pages[index];
    const next = pages[index + 1];
    return {
      type: 'state',
      n: index + 1,
      total: pages.length,
      label: cur?.label ?? '',
      notes: cur?.notes ?? '',
      next: next ? { n: next.n, label: next.label, ...(next.image ? { image: new URL(next.image, window.location.href).href } : { html: frameHtml(next.key) }) } : null,
    };
  }, [frameHtml, index, pages]);

  // The channel lives as long as present mode; the notes window says hello and gets the state.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    const ch = new BroadcastChannel(presenterChannel(props.artifactId));
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<PresenterMessage>) => {
      if (e.data?.type === 'hello') {
        ch.postMessage(stateRef.current());
      } else if (e.data?.type === 'go') {
        go(e.data.to);
      }
    };
    return () => {
      ch.postMessage({ type: 'state', n: 0, total: 0, label: '', notes: '', next: null, ended: true } satisfies PresenterState);
      ch.close();
      channel.current = null;
    };
  }, [go, props.artifactId]);
  useEffect(() => {
    channel.current?.postMessage(state());
  }, [state]);

  // Overlay: full screen when the browser allows it, and leaving full screen
  // leaves present mode. Window: full screen only on the button, and leaving
  // it keeps the window.
  useEffect(() => {
    const el = rootRef.current;
    el?.focus();
    let entered = false;
    const onChange = () => {
      setFullscreen(Boolean(document.fullscreenElement));
      if (document.fullscreenElement) {
        entered = true;
      } else if (entered && !windowed) {
        onClose();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    if (!windowed) {
      el?.requestFullscreen?.().catch(() => { /* a frame or a policy said no: present in the window */ });
    }
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [onClose, windowed]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      rootRef.current?.requestFullscreen?.().catch(() => toast.info(t('window.fullscreenBlocked')));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        go('next');
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        go('prev');
      } else if (e.key === 'Home') {
        e.preventDefault();
        go(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        go(pages.length - 1);
      } else if (e.key === 'Escape' && !windowed) {
        // In a window, Escape is the browser's: it leaves full screen and nothing more.
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, pages.length, windowed]);

  const openNotes = () => {
    const w = window.open('', `vocion-notes-${props.artifactId}`, 'popup,width=960,height=640');
    if (!w) {
      toast.info(t('present.notesBlocked'));
      return;
    }
    w.document.open();
    w.document.write(presenterNotesHtml(presenterChannel(props.artifactId), {
      title: t('present.notesTitle', { title: props.title }),
      heading: props.title,
      noNotes: t('present.noNotes'),
      next: t('present.next'),
      end: t('present.end'),
      previous: t('present.previous'),
      forward: t('present.forward'),
      waiting: t('present.waiting'),
      ended: t('present.ended'),
    }));
    w.document.close();
  };

  if (!page) {
    return null;
  }
  return (
    <div
      ref={rootRef}
      role={windowed ? 'main' : 'dialog'}
      aria-modal={windowed ? undefined : true}
      aria-label={t('present.label', { title: props.title })}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col bg-black outline-none"
      data-present-mode={windowed ? 'window' : 'overlay'}
    >
      <div className="relative min-h-0 flex-1">
        <PageFrame
          key={page.key}
          html={frameHtml(page.key)}
          width={SLIDE_WIDTH}
          height={SLIDE_HEIGHT}
          root=".vocion-slide > section"
          title={t('pageLabel', { unit: 'slide', n: page.n, label: page.label || t('untitled') })}
          className="absolute inset-0"
        />
        {/* A click on the slide moves the deck, as it does in any presenter.
            The frame would swallow the click (and the keys after it, once it
            has focus), so the click lands on this layer instead. Keyboard
            users have the arrows; the layer is not a control of its own. */}
        <div
          aria-hidden
          className="absolute inset-0 cursor-pointer"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            go(e.clientX - box.left < box.width / 3 ? 'prev' : 'next');
          }}
          data-present-advance
        />
      </div>
      <div className="flex items-center gap-2 px-4 py-2 opacity-60 focus-within:opacity-100 hover:opacity-100">
        <button type="button" className={CONTROL} onClick={() => go('prev')} disabled={index === 0} aria-label={t('present.previous')}>
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <span className="text-sm text-white tabular-nums" aria-live="polite" data-present-counter>
          {index + 1}
          {' / '}
          {pages.length}
        </span>
        <button type="button" className={CONTROL} onClick={() => go('next')} disabled={index === pages.length - 1} aria-label={t('present.forward')}>
          <ChevronRight className="size-4" aria-hidden />
        </button>
        <span className="flex-1" />
        <button type="button" className={CONTROL} onClick={openNotes} data-present-open-notes>
          <NotebookText className="size-4" aria-hidden />
          {t('present.openNotes')}
        </button>
        {windowed
          ? (
              <button type="button" className={CONTROL} onClick={toggleFullscreen} aria-pressed={fullscreen} data-present-fullscreen>
                {fullscreen ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
                {fullscreen ? t('window.exitFullscreen') : t('window.fullscreen')}
              </button>
            )
          : (
              <button type="button" className={CONTROL} onClick={onClose} data-present-exit>
                <X className="size-4" aria-hidden />
                {t('present.exit')}
              </button>
            )}
      </div>
    </div>
  );
}
