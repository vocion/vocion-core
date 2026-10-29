'use client';

/**
 * Present: the deck full screen, one slide at a time, on reveal.js (loaded
 * with a dynamic import when present mode opens, `revealDeck.ts`). Reveal owns
 * the slides: arrow keys, space and Page Up/Down move, Home/End jump, a swipe
 * moves on a touch screen, and each slide comes in with the transition its
 * `<section>` names (`data-transition`, fade when it names none). A click on
 * the slide moves on (its left third goes back); Escape leaves. "Open notes"
 * opens a second window with the current slide's notes and the next slide,
 * kept in step over a `BroadcastChannel` (`presenterNotes.ts`) — it can move
 * the deck too. Reduced motion turns every transition off.
 *
 * Each slide is still the pane's own page frame (`PageFrame`, `frameHtml`): the
 * deck's render page with that one slide, `asset:` images and Vocion's
 * elements resolved inside its sandbox. Reveal moves and fades the frames; it
 * never sees the slide's markup. Frames near the current slide are mounted,
 * the rest wait, so a long deck does not start forty frames at once.
 *
 * The same view fills a browser window of its own (`display="window"`, the
 * deck's `/window` route): nothing goes full screen until the person asks with
 * the Full screen button, leaving full screen keeps the window, and there is
 * no Exit — the window's own close is the way out. One slide view, two places
 * to show it (design principle 6).
 */

import type RevealApi from 'reveal.js';
import type { DeliverablePage } from './pages';
import type { PresenterMessage, PresenterState } from './presenterNotes';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, NotebookText, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '@/libs/decks/page';
import { PageFrame } from './PageFrame';
import { slideTransition } from './pages';
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

/** The keys reveal.js moves the deck on. Everything else (its overview, pause, help, F for full screen) stays ours or the browser's. */
const REVEAL_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', ' ', 'PageDown', 'PageUp', 'Home', 'End']);
/** How many slides either side of the current one keep a live frame. */
const MOUNTED = 2;

const CONTROL = 'inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

export function PresentMode(props: PresentModeProps) {
  const t = useTranslations('Deliverable');
  const [index, setIndex] = useState(Math.max(0, Math.min(props.start, props.pages.length - 1)));
  const rootRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<RevealApi.Api | null>(null);
  const [ready, setReady] = useState(false);
  // Reduced motion: no transition at all, the deck's or any slide's.
  const [still] = useState(() => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false));
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

  // Every move goes through reveal; its `slidechanged` sets the index the rest
  // of the view reads. A move made while reveal is still loading moves the
  // slide it will start on, so the first keys pressed are never lost.
  const startRef = useRef(index);
  const go = useCallback((to: number | 'next' | 'prev') => {
    const deck = deckRef.current;
    if (!deck) {
      const from = startRef.current;
      const next = Math.max(0, Math.min(pages.length - 1, to === 'next' ? from + 1 : to === 'prev' ? from - 1 : to));
      startRef.current = next;
      setIndex(next);
      return;
    }
    if (to === 'next') {
      deck.next();
    } else if (to === 'prev') {
      deck.prev();
    } else {
      deck.slide(Math.max(0, Math.min(pages.length - 1, to)));
    }
  }, [pages.length]);

  // reveal.js, once per present session, on the sections rendered below.
  useEffect(() => {
    const el = revealRef.current;
    let cancelled = false;
    void import('./revealDeck').then(async ({ Reveal }) => {
      if (cancelled || !el) {
        return;
      }
      const deck = new Reveal(el, {
        embedded: true,
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        margin: 0,
        minScale: 0.05,
        maxScale: 4,
        center: false,
        controls: false,
        progress: false,
        slideNumber: false,
        overview: false,
        help: false,
        pause: false,
        hash: false,
        history: false,
        respondToHashChanges: false,
        loop: false,
        mouseWheel: false,
        previewLinks: false,
        hideInactiveCursor: false,
        postMessage: false,
        postMessageEvents: false,
        transition: still ? 'none' : 'fade',
        backgroundTransition: 'none',
        viewDistance: MOUNTED + 1,
        keyboardCondition: e => REVEAL_KEYS.has(e.key),
      });
      await deck.initialize();
      if (cancelled) {
        deck.destroy();
        return;
      }
      // The start slide shows at once, not as a fade from the first: reveal's
      // own `no-transition` class holds every transition off while it moves
      // there, and comes off once the browser has laid that out.
      const slides = deck.getSlidesElement();
      slides?.classList.add('no-transition');
      deck.slide(startRef.current);
      void slides?.offsetHeight;
      slides?.classList.remove('no-transition');
      deck.on('slidechanged', () => setIndex(deck.getIndices().h ?? 0));
      deckRef.current = deck;
      setReady(true);
    });
    return () => {
      // A deck still initialising is destroyed when its initialize() returns, above.
      cancelled = true;
      deckRef.current?.destroy();
      deckRef.current = null;
    };
  }, [still]);

  // Slides added or removed while presenting (an edit landed): reveal re-reads them.
  const keys = pages.map(p => p.key).join('\n');
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck || !ready) {
      return;
    }
    deck.sync();
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect -- reveal is the source of the index; sync() moves it without a slidechanged
    setIndex(deck.getIndices().h ?? 0);
  }, [keys, ready]);

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

  // The moving keys are reveal's (`REVEAL_KEYS`) once it is up; Escape is ours.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!deckRef.current && REVEAL_KEYS.has(e.key)) {
        e.preventDefault();
        const k = e.key;
        go(k === 'Home' ? 0 : k === 'End' ? pages.length - 1 : k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' ? 'prev' : 'next');
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
      {/* Inline, so reveal's stage stays inside this box even where no stylesheet but reveal's has loaded. */}
      <div className="relative min-h-0 flex-1" style={{ position: 'relative', overflow: 'hidden' }}>
        {/* Reveal owns the classes and styles of `.reveal`, `.slides` and each
            section (present, past, future, display). React writes those
            classes once and never again, and gives a section only its
            transition attributes and the frame inside. */}
        <div style={{ position: 'absolute', inset: 0, background: '#000' }} data-present-stage>
          {/* eslint-disable-next-line tailwindcss/no-custom-classname -- reveal.js's own structure */}
          <div ref={revealRef} className="reveal" data-present-reveal={ready ? 'ready' : 'loading'}>
            <div className="slides">
              {pages.map((p, i) => {
                const tr = still ? {} : slideTransition(p.html);
                return (
                  <section key={p.key} data-transition={tr.transition} data-transition-speed={tr.speed} data-present-slide={p.key}>
                    {Math.abs(i - index) <= MOUNTED && (
                      <div style={{ position: 'relative', width: SLIDE_WIDTH, height: SLIDE_HEIGHT }}>
                        <PageFrame
                          html={frameHtml(p.key)}
                          width={SLIDE_WIDTH}
                          height={SLIDE_HEIGHT}
                          root=".vocion-slide > section"
                          title={t('pageLabel', { unit: 'slide', n: p.n, label: p.label || t('untitled') })}
                          className="absolute inset-0"
                        />
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
        {/* A click on the slide moves the deck, as it does in any presenter.
            The frame would swallow the click (and the keys after it, once it
            has focus), so the click lands on this layer instead. Keyboard
            users have the arrows; the layer is not a control of its own. */}
        <div
          aria-hidden
          className="absolute inset-0 z-10 cursor-pointer"
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
