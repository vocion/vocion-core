'use client';

import type { TourManifest, TourStep } from '@/libs/workspace/tour';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from '@/libs/I18nNavigation';

/**
 * WorkspaceTour — a driver.js-style guided walkthrough, dependency-free.
 *
 * Tours come from the workspace's `pages/tour.yaml` and `pages/tours/*.yaml`
 * (see libs/workspace/tour.ts). The overlay spotlights one element per step
 * (single div + giant box-shadow mask), walks across routes with the app
 * router, and keeps its position in localStorage so a mid-tour navigation
 * or reload resumes where it left off.
 *
 * A step ends one of three ways: the Next button; the audience tapping the
 * spotlit element (`advance: click` — everything else stays blocked, so
 * the tap that moves the tour is the tap that does the work); or the
 * element named by `waitFor` arriving (`advance: appear`, for watching an
 * agent work). Autoplay (`&autoplay=1`) holds each step for its dwell,
 * performs its own taps, and chains into the tour named by `next:`.
 *
 * Forcing behavior: while active, the mask swallows clicks outside the
 * spotlight and popover, so the audience follows the rail. Esc or “End
 * tour” always exits. Start via `?tour=<slug>`, the floating launcher, or
 * `autoStart` (first visit per browser).
 */

const SLUG_KEY = 'wsx-tour-slug';
const IDX_KEY = 'wsx-tour-idx';
const ACTIVE_KEY = 'wsx-tour-active';
const AUTOPLAY_KEY = 'wsx-tour-autoplay';
const DONE_KEY = 'wsx-tour-done';

type Rect = { top: number; left: number; width: number; height: number };

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch { /* private mode */ }
}

/**
 * The path part of a step route — a route may carry a query string.
 * @param route
 */
function routePath(route: string): string {
  return route.split('?')[0]!.replace(/\/$/, '') || '/';
}

/**
 * The first visible element matching the step, honouring `selectorText`.
 * @param selector - CSS selector.
 * @param text - Optional text the element must contain.
 */
function findTarget(selector: string, text?: string): HTMLElement | null {
  let nodes: HTMLElement[];
  try {
    nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  } catch {
    return null;
  }
  const needle = text?.toLowerCase();
  return nodes.find((n) => {
    if (needle && !(n.textContent ?? '').toLowerCase().includes(needle)) {
      return false;
    }
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? null;
}

/**
 * Tap an element the way a finger does — pointer and mouse down, up, then
 * click, at its centre — because some controls act on pointer events and a
 * bare `.click()` never reaches them.
 * @param el - The element autoplay taps.
 */
function tapElement(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', at));
  el.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', at));
  el.click();
}

/**
 * How long autoplay holds a step: long enough to read it.
 * @param step
 */
function dwellFor(step: TourStep): number {
  if (step.dwellMs) {
    return step.dwellMs;
  }
  return Math.min(12000, Math.max(4200, 2200 + (step.title.length + step.body.length) * 42));
}

export function WorkspaceTour({ tours }: { tours: TourManifest[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [slug, setSlug] = useState<string>(tours[0]!.slug);
  const [active, setActive] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [idx, setIdx] = useState(0);
  // The spotlight's box, keyed to the step it was measured for: a new step
  // reads no box until its own element is found, with nothing to reset.
  const [measured, setMeasured] = useState<{ key: string; rect: Rect } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [popSize, setPopSize] = useState({ w: 400, h: 240 });
  const [tapping, setTapping] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  const tour = tours.find(t => t.slug === slug) ?? tours[0]!;
  const steps = tour.steps;
  const step = steps[Math.min(idx, steps.length - 1)]!;
  const stepKey = `${slug}:${idx}`;
  const rect = measured?.key === stepKey ? measured.rect : null;
  const ringOnly = (step.mask ?? tour.mask) === 'none';
  const isLast = idx >= steps.length - 1;
  // The path a step route names: no locale, no `/w/<workspace>` prefix
  // (docs/routing.md), no trailing slash.
  const normalizedPath = useMemo(() => pathname.replace(/^\/[a-z]{2}(?=\/)/, '').replace(/^\/w\/[^/]+(?=\/)/, '').replace(/\/$/, '') || '/', [pathname]);
  const visibleTours = tours.filter(t => !t.hidden);

  const begin = (tourSlug: string, at = 0, auto = false) => {
    writeStorage(SLUG_KEY, tourSlug);
    writeStorage(ACTIVE_KEY, '1');
    writeStorage(IDX_KEY, String(at));
    writeStorage(AUTOPLAY_KEY, auto ? '1' : null);
    setSlug(tourSlug);
    setIdx(at);
    setAutoplay(auto);
    setMenuOpen(false);
    setActive(true);
  };

  const end = () => {
    writeStorage(ACTIVE_KEY, null);
    writeStorage(IDX_KEY, null);
    writeStorage(AUTOPLAY_KEY, null);
    writeStorage(DONE_KEY, '1');
    setActive(false);
    setAutoplay(false);
  };

  const advance = () => {
    if (!isLast) {
      setIdx(i => i + 1);
      return;
    }
    // Autoplay chains into the next tour; by hand, the last step ends.
    const next = tour.next ? tours.find(t => t.slug === tour.next) : undefined;
    if (autoplay && next) {
      begin(next.slug, 0, true);
      return;
    }
    end();
  };
  // Effects call the latest `advance` through a ref: a live page re-renders
  // the shell every few seconds with new props, and an effect keyed on the
  // callback would restart its timer each time and never reach its dwell.
  const advanceRef = useRef(advance);
  useEffect(() => {
    advanceRef.current = advance;
  });

  // `?tour=<slug>` (or `?tour=1` for the first) starts a tour — on mount and
  // on any client navigation that carries it — then is stripped from the
  // URL so a reload or End doesn't restart it.
  const tourParam = searchParams.get('tour');
  const autoplayParam = searchParams.get('autoplay') === '1';
  // What is running now, for the effect below: it is keyed on the URL, not
  // on the tour's state, and must not restart when the state changes.
  const runningRef = useRef({ active, slug });
  useEffect(() => {
    runningRef.current = { active, slug };
  });
  useEffect(() => {
    if (tourParam) {
      const wanted = tourParam === '1' ? tours[0] : tours.find(t => t.slug === tourParam);
      // The param can come back after the tour has begun: Next's router keeps
      // its own copy of the URL, and a live page's refresh or a preview
      // opening (`?preview=`) re-syncs it with `?tour=` still on. The stale
      // param is stripped again; the tour it names is left where it is.
      const alreadyRunning = wanted !== undefined && runningRef.current.active && runningRef.current.slug === wanted.slug;
      if (wanted && !alreadyRunning) {
        // Scheduled, not called: starting a tour is a response to the URL,
        // and the render that read the URL should finish first.
        queueMicrotask(() => begin(wanted.slug, 0, autoplayParam));
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('tour');
      url.searchParams.delete('autoplay');
      // Null state, so Next's router adopts the URL (see previewState.ts).
      window.history.replaceState(null, '', url.toString());
    }
  }, [tourParam, autoplayParam]);

  // Resume a tour in progress, or auto-start one.
  useEffect(() => {
    if (tourParam) {
      return;
    }
    const savedSlug = readStorage(SLUG_KEY);
    if (readStorage(ACTIVE_KEY) === '1' && savedSlug && tours.some(t => t.slug === savedSlug)) {
      const saved = Number(readStorage(IDX_KEY) ?? '0');
      const length = tours.find(t => t.slug === savedSlug)!.steps.length;
      queueMicrotask(() => begin(savedSlug, Number.isFinite(saved) ? Math.min(saved, length - 1) : 0, readStorage(AUTOPLAY_KEY) === '1'));
      return;
    }
    const auto = tours.find(t => t.autoStart);
    if (auto && readStorage(DONE_KEY) !== '1') {
      queueMicrotask(() => begin(auto.slug, 0));
    }
  }, []);

  // Navigate to the step's route when it differs from where we are.
  // Prefix steps accept any route beneath them (dynamic ids); interactive
  // steps never yank the browser back once the audience starts clicking.
  const stepPath = routePath(step.route);
  const onRoute = step.routePrefix
    ? normalizedPath.startsWith(stepPath)
    : normalizedPath === stepPath;
  useEffect(() => {
    if (!active) {
      return;
    }
    writeStorage(IDX_KEY, String(idx));
    if (!onRoute && !(step.interactive && idx > 0)) {
      router.push(step.route as never);
    }
  }, [active, idx, onRoute, router, step.route]);

  // Locate + track the spotlit element. The page may still be rendering, so
  // keep looking; scroll it into view once, then follow it as it moves.
  useEffect(() => {
    if (!active) {
      return;
    }
    targetRef.current = null;
    if (!step.selector || !onRoute) {
      return;
    }
    let scrolled = false;
    let raf = 0;
    const measure = () => {
      const el = findTarget(step.selector!, step.selectorText);
      targetRef.current = el;
      if (!el) {
        return;
      }
      const vh = window.innerHeight;
      if (!scrolled) {
        scrolled = true;
        const raw = el.getBoundingClientRect();
        // Elements taller than the viewport (long tables) would swallow the
        // screen: pin them to the top and cap the spotlight's height.
        const tall = raw.height > vh * 0.7;
        if (raw.top < 0 || raw.bottom > vh) {
          el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'smooth' });
        }
      }
      const r = el.getBoundingClientRect();
      const top = Math.max(8, r.top - 8);
      // A dimmed spotlight caps tall elements so the page still shows; a ring
      // traces the whole element. Both stay inside the viewport.
      const height = ringOnly ? Math.min(r.height + 16, vh - top - 8) : Math.min(r.height + 16, vh * 0.62, vh - top - 8);
      const left = Math.max(8, r.left - 8);
      const next = { top, left, width: Math.min(r.width + 16, window.innerWidth - left - 8), height: Math.max(40, height) };
      setMeasured((prev) => {
        const p = prev?.key === stepKey ? prev.rect : null;
        const same = p && Math.abs(p.top - next.top) < 1 && Math.abs(p.left - next.left) < 1 && Math.abs(p.width - next.width) < 1 && Math.abs(p.height - next.height) < 1;
        return same ? prev : { key: stepKey, rect: next };
      });
    };
    measure();
    const poll = setInterval(measure, 250);
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      clearInterval(poll);
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [active, stepKey, onRoute, step.selector, step.selectorText, ringOnly]);

  // `advance: appear` — move on once the awaited element is on the page.
  useEffect(() => {
    if (!active || step.advance !== 'appear' || !step.waitFor || !onRoute) {
      return;
    }
    let done = false;
    const poll = setInterval(() => {
      if (!done && findTarget(step.waitFor!, step.waitForText)) {
        done = true;
        // A beat on the finished state before the tour moves on.
        setTimeout(() => advanceRef.current(), 900);
      }
    }, 250);
    return () => clearInterval(poll);
  }, [active, idx, slug, onRoute, step.advance, step.waitFor, step.waitForText]);

  // `advance: click` — the tap on the spotlit element is let through and
  // moves the tour; every other tap outside the popover is swallowed.
  useEffect(() => {
    if (!active || step.advance !== 'click') {
      return;
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      // Toasts are the product talking back; they stay closable mid-tour.
      if (!t || popRef.current?.contains(t) || (t as HTMLElement).closest?.('[data-tour-chrome]')) {
        return;
      }
      const el = targetRef.current ?? findTarget(step.selector!, step.selectorText);
      if (el && el.contains(t)) {
        // The tour follows its own links: a spotlit same-origin link is
        // navigated here, client-side and in this tab — including one that
        // would open a new tab (the full-screen document) — so no other
        // handler on the way (a preview closing itself) can cancel the move.
        const link = (t as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
        if (link && new URL(link.href, window.location.href).origin === window.location.origin) {
          e.preventDefault();
          const url = new URL(link.href, window.location.href);
          // Advance first: the tapped step's own route guard would otherwise
          // see the new page land before the step moved on, and push back.
          advanceRef.current();
          router.push(`${url.pathname}${url.search}` as never);
          return;
        }
        setTimeout(() => advanceRef.current(), 350);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active, idx, slug, step.advance, step.selector, step.selectorText, router]);

  // `scrollTo` — page to the named element (in a same-origin frame, when
  // given) once it exists. The frame may still be loading, so keep looking.
  const scrollKey = step.scrollTo ? JSON.stringify(step.scrollTo) : '';
  useEffect(() => {
    if (!active || !onRoute || !scrollKey) {
      return;
    }
    const { target, index, frame } = JSON.parse(scrollKey) as NonNullable<TourStep['scrollTo']>;
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      let root: Document | null = document;
      const iframe = frame ? document.querySelector(frame) as HTMLIFrameElement | null : null;
      if (frame) {
        try {
          root = iframe?.contentDocument ?? null;
        } catch {
          root = null;
        }
      }
      const el = root?.querySelectorAll(target)[index] as HTMLElement | undefined;
      if (el) {
        clearInterval(poll);
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // A sandboxed document (opaque origin) cannot be reached into; ask it
      // instead — served documents listen for this (libs/tools/artifacts/serve.ts).
      // Asked a few times, since the frame may still be loading; it is idempotent.
      if (iframe?.contentWindow && !root) {
        iframe.contentWindow.postMessage({ type: 'vocion:scroll-to', target, index }, '*');
        if (tries >= 6) {
          clearInterval(poll);
        }
        return;
      }
      if (tries > 40) {
        clearInterval(poll);
      }
    }, 250);
    return () => clearInterval(poll);
  }, [active, idx, slug, onRoute, scrollKey]);

  // Autoplay: hold each step, perform its tap, then move on.
  useEffect(() => {
    if (!active || !autoplay || step.advance === 'appear') {
      return;
    }
    const dwell = dwellFor(step);
    if (step.advance === 'click') {
      const show = setTimeout(() => setTapping(true), Math.max(1200, dwell - 1400));
      const tap = setTimeout(() => {
        setTapping(false);
        const el = targetRef.current ?? findTarget(step.selector!, step.selectorText);
        // The capture listener sees this click and advances the tour.
        if (el) {
          tapElement(el);
        }
        if (!el) {
          advanceRef.current();
        }
      }, dwell);
      return () => {
        clearTimeout(show);
        clearTimeout(tap);
        setTapping(false);
      };
    }
    const t = setTimeout(() => advanceRef.current(), dwell);
    return () => clearTimeout(t);
    // Keyed on the step's position, not its object: a refresh hands over an
    // equal step as a new object, and must not restart the dwell.
  }, [active, autoplay, idx, slug]);

  // Measure the popover so placement clamps against its real size.
  useEffect(() => {
    if (!active || !popRef.current) {
      return;
    }
    const r = popRef.current.getBoundingClientRect();
    if (Math.abs(r.width - popSize.w) > 2 || Math.abs(r.height - popSize.h) > 2) {
      setPopSize({ w: r.width, h: r.height });
    }
  });

  // Keyboard: ←/→ navigate, Esc ends.
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        end();
      }
      if (e.key === 'ArrowRight') {
        advance();
      }
      if (e.key === 'ArrowLeft' && idx > 0) {
        setIdx(i => i - 1);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [active, idx, end, advance]);

  if (!active) {
    if (visibleTours.length === 0) {
      return null;
    }
    return (
      <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2" data-tour-chrome>
        {menuOpen && visibleTours.length > 1 && (
          <div className="w-72 overflow-hidden rounded-xl border border-border bg-background shadow-xl">
            {visibleTours.map(t => (
              <button
                key={t.slug}
                type="button"
                onClick={() => begin(t.slug, 0)}
                className="block w-full px-4 py-3 text-left hover:bg-muted"
              >
                <div className="text-sm font-medium">{t.title}</div>
                {t.description && <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => (visibleTours.length > 1 ? setMenuOpen(o => !o) : begin(visibleTours[0]!.slug, 0))}
          className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium shadow-md hover:bg-muted"
        >
          ▸
          {' '}
          {visibleTours.length > 1 ? 'Guided tours' : visibleTours[0]!.title}
        </button>
      </div>
    );
  }

  const centered = !rect || step.placement === 'center';
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const { w: POP_W, h: POP_H } = popSize;
  const clamp = (top: number, left: number): React.CSSProperties => ({
    top: Math.min(Math.max(12, top), Math.max(12, vh - POP_H - 12)),
    left: Math.min(Math.max(12, left), Math.max(12, vw - POP_W - 12)),
  });
  const popStyle: React.CSSProperties = centered
    ? { top: Math.max(12, (vh - POP_H) / 2), left: Math.max(12, (vw - POP_W) / 2) }
    : step.placement === 'top'
      ? clamp(rect.top - POP_H - 14, rect.left)
      : step.placement === 'left'
        ? clamp(rect.top, rect.left - POP_W - 14)
        : step.placement === 'right'
          ? clamp(rect.top, rect.left + rect.width + 14)
          : clamp(rect.top + rect.height + 14, rect.left); // bottom (default)

  const dim = (step.mask ?? tour.mask) !== 'none';
  const caption = (step.presentation ?? tour.presentation) === 'caption';
  const waiting = step.advance === 'appear';
  const tapStep = step.advance === 'click';
  // Page taps reach the page on interactive steps, and on tap steps (where
  // the capture listener decides which tap counts).
  const passThrough = step.interactive || tapStep;

  return (
    <div
      className="fixed inset-0 z-50"
      style={passThrough || waiting ? { pointerEvents: 'none' } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={tour.title}
      data-tour-chrome
      data-tour-slug={slug}
      data-tour-step={idx + 1}
      data-tour-steps={steps.length}
    >
      <style>
        {`
        /* Toasts leave the bottom-right, where tour cards and decision
           buttons sit, for the top-left, and stay above the mask. */
        /* A tour is a performance: the product's toasts wait until it ends. */
        [data-toast-viewport] { display: none !important; }
        @keyframes wsx-tour-in { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
        @keyframes wsx-tour-pulse { 0% { box-shadow: 0 0 0 0 rgba(245,158,11,.55); } 70% { box-shadow: 0 0 0 14px rgba(245,158,11,0); } 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); } }
        @keyframes wsx-tour-work { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
        @keyframes wsx-tour-tap { 0% { transform: scale(1); opacity: .9; } 50% { transform: scale(.82); opacity: 1; } 100% { transform: scale(1); opacity: .9; } }
      `}
      </style>
      {/* Spotlight mask: one div whose box-shadow dims everything else. */}
      {rect && !centered
        ? (
            <div
              className="absolute rounded-xl"
              style={{
                ...rect,
                // Dimmed: one giant shadow darkens everything else. Undimmed:
                // the page stays as it is and the element gets a ring.
                boxShadow: dim
                  ? '0 0 0 99999px rgba(12, 20, 26, 0.42)'
                  : '0 0 0 3px rgba(242, 106, 27, 0.95), 0 0 0 9px rgba(242, 106, 27, 0.16), 0 18px 40px -12px rgba(12, 20, 26, 0.35)',
                transition: 'top 450ms cubic-bezier(.2,.8,.2,1), left 450ms cubic-bezier(.2,.8,.2,1), width 450ms cubic-bezier(.2,.8,.2,1), height 450ms cubic-bezier(.2,.8,.2,1)',
                pointerEvents: 'none',
              }}
            >
              {tapStep && (
                <div className="absolute inset-0 rounded-xl ring-2 ring-amber-400" style={{ animation: 'wsx-tour-pulse 1.6s ease-out infinite' }} />
              )}
              {tapping && (
                <div
                  className="absolute size-10 rounded-full border-2 border-white bg-amber-400/70 shadow-lg"
                  style={{ left: 'calc(50% - 20px)', top: 'calc(50% - 20px)', animation: 'wsx-tour-tap .6s ease-in-out infinite' }}
                />
              )}
            </div>
          )
        : dim && <div className="absolute inset-0 bg-[rgba(12,20,26,0.42)]" style={{ transition: 'opacity 300ms' }} />}
      {/* click shield: keeps the walkthrough on rails; Esc / End tour always exits */}
      {!passThrough && !waiting && <div className="absolute inset-0" aria-hidden="true" />}

      {/* Escape hatch, bottom-left: clear of the account menu and the
          header, reachable wherever the popover lands. In caption mode it
          lives inside the caption bar instead. */}
      {!caption && (
        <button
          type="button"
          onClick={end}
          data-tour-end
          className="absolute bottom-4 left-4 z-20 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-lg hover:bg-muted"
          style={{ pointerEvents: 'auto' }}
        >
          ✕ End tour
        </button>
      )}

      {caption && (
        <div
          ref={popRef}
          key={`caption-${slug}-${idx}`}
          className="absolute inset-x-0 bottom-0 z-10"
          data-tour-caption
          style={{ pointerEvents: 'auto', animation: 'wsx-tour-in 420ms cubic-bezier(.2,.8,.2,1) both' }}
        >
          <div className="h-1 w-full bg-black/10">
            <div className="h-full bg-[#F26A1B]" style={{ width: `${((idx + 1) / steps.length) * 100}%`, transition: 'width 600ms cubic-bezier(.2,.8,.2,1)' }} />
          </div>
          <div className="flex items-center gap-8 bg-[#1B2733]/95 px-12 py-7 text-white backdrop-blur">
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 text-[15px] font-semibold tracking-[0.12em] text-[#F26A1B] uppercase">{step.eyebrow ?? tour.title}</div>
              <div className="text-[34px] leading-tight font-semibold tracking-tight">{step.caption ?? step.title}</div>
            </div>
            {waiting && (
              <div className="relative h-1.5 w-40 shrink-0 overflow-hidden rounded-full bg-white/15">
                <div className="absolute inset-y-0 w-1/3 rounded-full bg-[#F26A1B]" style={{ animation: 'wsx-tour-work 1.2s ease-in-out infinite' }} />
              </div>
            )}
            {!autoplay && (
              <button type="button" onClick={advance} className="shrink-0 rounded-xl bg-white px-6 py-3 text-lg font-semibold text-[#1B2733]">
                {isLast ? 'Finish' : 'Next'}
              </button>
            )}
            <button type="button" onClick={end} data-tour-end className="shrink-0 rounded-full border border-white/25 px-4 py-2 text-sm text-white/80 hover:bg-white/10">
              ✕ End tour
            </button>
          </div>
        </div>
      )}
      {!caption && (
        <div
          ref={popRef}
          key={`${slug}-${idx}`}
          className="absolute z-10 max-h-[calc(100vh-24px)] w-[400px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-2xl"
          style={{ ...popStyle, pointerEvents: 'auto', animation: 'wsx-tour-in 380ms cubic-bezier(.2,.8,.2,1) both', transition: 'top 450ms cubic-bezier(.2,.8,.2,1), left 450ms cubic-bezier(.2,.8,.2,1)' }}
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {steps.map((s, i) => (
                <div
                  key={`${s.title}-${i}`}
                  className={`h-1 flex-1 rounded-full transition-colors duration-500 ${i <= idx ? 'bg-foreground' : 'bg-muted'}`}
                />
              ))}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {idx + 1}
              /
              {steps.length}
            </div>
          </div>
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {step.eyebrow ?? tour.title}
          </div>
          <div className="mb-1.5 text-lg leading-snug font-semibold">{step.title}</div>
          <p className="mb-4 text-[15px] leading-relaxed whitespace-pre-line text-muted-foreground">{step.body}</p>
          {waiting && (
            <div className="relative mb-4 h-1 overflow-hidden rounded-full bg-muted">
              <div className="absolute inset-y-0 w-1/3 rounded-full bg-amber-400" style={{ animation: 'wsx-tour-work 1.2s ease-in-out infinite' }} />
            </div>
          )}
          <div className="flex items-center gap-2">
            {idx > 0 && !autoplay && (
              <button type="button" onClick={() => setIdx(i => i - 1)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">
                Back
              </button>
            )}
            {!autoplay && step.advance === 'next' && (
              <button type="button" onClick={advance} className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90">
                {step.nextLabel ?? (isLast ? 'Finish' : 'Next')}
              </button>
            )}
            {!autoplay && tapStep && (
              <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                {step.nextLabel ?? 'Tap the highlighted button'}
              </span>
            )}
            {waiting && (
              <span className="text-sm text-muted-foreground">{step.nextLabel ?? 'Working…'}</span>
            )}
            {autoplay && (
              <span className="text-xs text-muted-foreground">Playing automatically</span>
            )}
            <button type="button" onClick={end} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
              End tour
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
