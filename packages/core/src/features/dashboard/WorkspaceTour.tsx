'use client';

import type { TourStep } from '@/libs/workspace/tour';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * WorkspaceTour — a driver.js-style guided walkthrough, dependency-free.
 *
 * Steps come from the workspace's `pages/tour.yaml` (see
 * libs/workspace/tour.ts). The overlay spotlights one element per step
 * (single div + giant box-shadow mask), walks across routes with the app
 * router, and keeps its position in localStorage so a mid-tour navigation
 * or reload resumes where it left off.
 *
 * Forcing behavior: while active, the mask swallows clicks outside the
 * spotlight and popover, so the audience follows the rail. Esc or “End
 * tour” always exits. Start via `?tour=1`, the floating launcher, or
 * `autoStart` (first visit per browser).
 */

const IDX_KEY = 'wsx-tour-idx';
const ACTIVE_KEY = 'wsx-tour-active';
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

export function WorkspaceTour({ steps, title, autoStart }: {
  steps: TourStep[];
  title: string;
  autoStart: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const step = steps[Math.min(idx, steps.length - 1)]!;
  // Strip the locale prefix (/en/dashboard/... → /dashboard/...) for matching.
  const normalizedPath = useMemo(() => pathname.replace(/^\/[a-z]{2}(?=\/)/, ''), [pathname]);

  const begin = useCallback((at = 0) => {
    writeStorage(ACTIVE_KEY, '1');
    writeStorage(IDX_KEY, String(at));
    setIdx(at);
    setActive(true);
  }, []);

  const end = useCallback(() => {
    writeStorage(ACTIVE_KEY, null);
    writeStorage(IDX_KEY, null);
    writeStorage(DONE_KEY, '1');
    setActive(false);
    setRect(null);
  }, []);

  // Resume / auto-start / ?tour=1 (consumed once, then stripped from the
  // URL so a reload or End doesn't restart the tour).
  useEffect(() => {
    if (searchParams.get('tour') === '1') {
      begin(0);
      const url = new URL(window.location.href);
      url.searchParams.delete('tour');
      window.history.replaceState(null, '', url.toString());
      return;
    }
    if (readStorage(ACTIVE_KEY) === '1') {
      const saved = Number(readStorage(IDX_KEY) ?? '0');
      begin(Number.isFinite(saved) ? Math.min(saved, steps.length - 1) : 0);
      return;
    }
    if (autoStart && readStorage(DONE_KEY) !== '1') {
      begin(0);
    }
  }, []);

  // Navigate to the step's route when it differs from where we are.
  // Prefix steps accept any route beneath them (dynamic ids); interactive
  // steps never yank the browser back once the audience starts clicking.
  const onRoute = step.routePrefix
    ? normalizedPath.startsWith(step.route)
    : normalizedPath === step.route;
  useEffect(() => {
    if (!active) {
      return;
    }
    writeStorage(IDX_KEY, String(idx));
    if (!onRoute && !(step.interactive && idx > 0)) {
      router.push(step.route as never);
    }
  }, [active, idx, onRoute, router, step.route]);

  // Locate + track the spotlit element (poll: the page may still be rendering).
  useEffect(() => {
    if (!active) {
      return;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }
    setRect(null);
    if (!step.selector || !onRoute) {
      return;
    }
    let tries = 0;
    const find = () => {
      const el = document.querySelector(step.selector!);
      if (el) {
        const vh = window.innerHeight;
        const raw = el.getBoundingClientRect();
        // Elements taller than the viewport (long tables) would swallow the
        // screen: pin them to the top and cap the spotlight's height.
        const tall = raw.height > vh * 0.7;
        el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'smooth' });
        const r = el.getBoundingClientRect();
        const top = Math.max(8, r.top - 8);
        const height = Math.min(r.height + 16, vh * 0.55, vh - top - 8);
        setRect({ top, left: Math.max(8, r.left - 8), width: Math.min(r.width + 16, window.innerWidth - 16), height: Math.max(40, height) });
      } else if (++tries > 25) {
        clearInterval(pollRef.current!);
      }
    };
    find();
    pollRef.current = setInterval(find, 200);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [active, idx, onRoute, step.selector]);

  // Keyboard: ←/→ navigate, Esc ends.
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        end();
      }
      if (e.key === 'ArrowRight' && idx < steps.length - 1) {
        setIdx(i => i + 1);
      }
      if (e.key === 'ArrowLeft' && idx > 0) {
        setIdx(i => i - 1);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [active, idx, steps.length, end]);

  if (!active) {
    return (
      <button
        type="button"
        onClick={() => begin(0)}
        className="fixed right-4 bottom-4 z-40 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium shadow-md hover:bg-muted"
      >
        ▸
        {' '}
        {title}
      </button>
    );
  }

  const centered = !rect;
  // Estimated popover box for clamping (real size varies little).
  const POP_W = 380;
  const POP_H = 230;
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const clamp = (top: number, left: number): React.CSSProperties => ({
    top: Math.min(Math.max(12, top), Math.max(12, vh - POP_H - 12)),
    left: Math.min(Math.max(12, left), Math.max(12, vw - POP_W - 12)),
  });
  const popStyle: React.CSSProperties = centered
    ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    : step.placement === 'top'
      ? clamp(rect.top - POP_H - 12, rect.left)
      : step.placement === 'left'
        ? clamp(rect.top, rect.left - POP_W - 12)
        : step.placement === 'right'
          ? clamp(rect.top, rect.left + rect.width + 12)
          : clamp(rect.top + rect.height + 12, rect.left); // bottom (default)

  return (
    <div
      className="fixed inset-0 z-50"
      style={step.interactive ? { pointerEvents: 'none' } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Spotlight mask: one div whose box-shadow dims everything else. It
          also swallows clicks so the walkthrough stays on rails. */}
      {rect
        ? (
            <div
              className="absolute rounded-lg transition-all duration-300"
              style={{ ...rect, boxShadow: '0 0 0 99999px rgba(15, 25, 30, 0.35)' }}
            />
          )
        : <div className="absolute inset-0 bg-[rgba(15,25,30,0.35)]" />}
      {/* click shield: keeps the walkthrough on rails; Esc / End tour always exits */}
      {!step.interactive && <div className="absolute inset-0" aria-hidden="true" />}

      {/* Escape hatch pinned to the viewport — reachable no matter where the
          popover lands or how tall the spotlight is. */}
      <button
        type="button"
        onClick={end}
        className="absolute right-4 top-4 z-20 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-lg hover:bg-muted"
        style={{ pointerEvents: 'auto' }}
      >
        ✕ End tour (Esc)
      </button>

      <div
        className="absolute z-10 max-h-[calc(100vh-24px)] w-[380px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-2xl"
        style={{ ...popStyle, pointerEvents: 'auto' }}
      >
        <div className="mb-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {title}
          {' · '}
          {idx + 1}
          {' / '}
          {steps.length}
        </div>
        <div className="mb-1 text-base font-semibold">{step.title}</div>
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        <div className="flex items-center gap-2">
          {idx > 0 && (
            <button type="button" onClick={() => setIdx(i => i - 1)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              Back
            </button>
          )}
          {idx < steps.length - 1
            ? (
                <button type="button" onClick={() => setIdx(i => i + 1)} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90">
                  Next
                </button>
              )
            : (
                <button type="button" onClick={end} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90">
                  Finish
                </button>
              )}
          <button type="button" onClick={end} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            End tour (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
