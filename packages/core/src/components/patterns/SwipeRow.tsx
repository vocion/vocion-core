'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { Check, X } from 'lucide-react';
import { createContext, use, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { cn } from '@/utils/Helpers';
import { RowMenu } from './RowMenu';

/**
 * A row's decision verbs on a phone: swipe right for the first, left for the
 * second, both with Undo — and the same verbs in the row's ⋯ menu, because a
 * gesture nobody can see is not the only way in.
 *
 * Chris, 2026-10-09, on the Review queue at 390px: the ✓, ✗ and › took the
 * row's width and the title was cut to ten characters. On a phone the inline
 * buttons go; the title gets the width; the verbs move under the finger. From
 * `sm` up the row keeps its inline buttons and none of this is drawn.
 *
 * Undo is a delay, not a reversal: a swiped verb waits `UNDO_MS` behind a
 * toast with Undo, then runs. Nothing has happened yet when the person taps
 * Undo, so there is nothing to take back — which is the only Undo that works
 * for every verb, including one that sends something.
 */

export type SwipeAction = {
  /** The verb, as the row's button names it: "Approve", "Reject". */
  label: string;
  /** `pass` draws green under the finger, `fail` red. */
  tone: 'pass' | 'fail' | 'neutral';
  icon?: LucideIcon;
  /**
   * Runs once the Undo window has passed. Return `false` (or throw) when it
   * did not take, and the row comes back; the caller says why.
   */
  run: () => void | boolean | Promise<void | boolean>;
};

export type RowSwipe = {
  /** Swipe right (the finger moves right): the yes. */
  right?: SwipeAction;
  /** Swipe left: the no. */
  left?: SwipeAction;
  /** What the row is, for the toast and the menu's name — usually its title. */
  subject: string;
};

/** How long a swiped verb waits for Undo. The toast shows for the same time. */
export const UNDO_MS = 5000;

/** How far the finger travels before letting go commits, as a share of the row. */
const COMMIT_SHARE = 0.32;

type Trigger = (action: SwipeAction) => void;

const SwipeContext = createContext<{ swipe: RowSwipe; trigger: Trigger } | null>(null);

/**
 * Run a verb after the Undo window, hiding the row meanwhile.
 * @param subject - What the row is, for the toast.
 */
function useDeferredVerb(subject: string) {
  const [pending, setPending] = useState<SwipeAction | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    // Leaving the page does not cancel a verb the person did not undo: the
    // timer is left to fire. Nothing to clean up but the reference.
    timer.current = null;
  }, []);

  const trigger: Trigger = (action) => {
    setPending(action);
    let undone = false;
    const id = toast.info(`${action.label} · ${subject}`, {
      description: 'Undo within 5 seconds.',
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          if (timer.current) {
            clearTimeout(timer.current);
          }
          toast.dismiss(id);
          setPending(null);
        },
      },
    });
    timer.current = setTimeout(async () => {
      if (undone) {
        return;
      }
      try {
        const ok = await action.run();
        if (ok === false) {
          setPending(null);
        }
      } catch {
        setPending(null);
      }
    }, UNDO_MS);
  };
  return { pending, trigger };
}

/**
 * The swipeable surface around one row. Only a touch or pen drag moves it;
 * a vertical drag is left to the page (`touch-action: pan-y`), and a drag that
 * moved swallows the click it would otherwise end in.
 * @param props
 * @param props.swipe - The verbs.
 * @param props.children - The row.
 */
export function SwipeRow({ swipe, children }: { swipe: RowSwipe; children: ReactNode }) {
  const { pending, trigger } = useDeferredVerb(swipe.subject);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; axis: 'x' | 'y' | null; width: number } | null>(null);
  const moved = useRef(false);

  if (pending) {
    return null;
  }

  const allowed = (d: number) => (d > 0 ? swipe.right : d < 0 ? swipe.left : undefined);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') {
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, axis: null, width: e.currentTarget.offsetWidth };
    moved.current = false;
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) {
      return;
    }
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.axis === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) {
        return;
      }
      d.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (d.axis === 'x') {
        setDragging(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // The browser no longer tracks this pointer; moves on the row still arrive.
        }
      }
    }
    if (d.axis !== 'x') {
      return;
    }
    moved.current = true;
    // A direction with no verb resists: the row moves a little and springs back.
    setDx(allowed(mx) ? mx : mx / 6);
  };
  const onEnd = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    const action = allowed(dx);
    if (d && action && Math.abs(dx) > d.width * COMMIT_SHARE) {
      setDx(0);
      trigger(action);
      return;
    }
    setDx(0);
  };

  const showing = allowed(dx);
  const Icon = showing?.icon ?? (dx > 0 ? Check : X);

  return (
    <SwipeContext value={{ swipe, trigger }}>
      <div data-slot="swipe-row" className="relative overflow-hidden rounded-lg sm:overflow-visible">
        {showing && dx !== 0 && (
          <div
            aria-hidden
            className={cn(
              'absolute inset-0 flex items-center gap-2 rounded-lg px-5 text-sm font-medium',
              dx > 0 ? 'justify-start' : 'justify-end',
              showing.tone === 'pass' && 'bg-brand-pass/15 text-brand-pass',
              showing.tone === 'fail' && 'bg-brand-fail/15 text-brand-fail',
              showing.tone === 'neutral' && 'bg-surface-soft text-foreground',
            )}
          >
            <Icon className="size-4" />
            {showing.label}
          </div>
        )}
        <div
          className="relative touch-pan-y bg-background"
          style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : 'transform 180ms ease-out' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onEnd}
          onClickCapture={(e) => {
            if (moved.current) {
              e.preventDefault();
              e.stopPropagation();
              moved.current = false;
            }
          }}
        >
          {children}
        </div>
      </div>
    </SwipeContext>
  );
}

/**
 * The row's ⋯ on a phone: the swipe verbs as menu items, through the same
 * Undo window. The way in for anyone who does not swipe — a screen reader, a
 * switch, a person who never found the gesture. Hidden from `sm` up, where
 * the inline buttons are.
 */
export function SwipeMenu() {
  const ctx = use(SwipeContext);
  if (!ctx) {
    return null;
  }
  const { swipe, trigger } = ctx;
  const items = [swipe.right, swipe.left]
    .filter((a): a is SwipeAction => a !== undefined)
    .map(a => ({ label: a.label, icon: a.icon, onClick: () => trigger(a) }));
  return (
    <span className="shrink-0 sm:hidden">
      <RowMenu items={items} label={`Actions: ${swipe.subject}`} />
    </span>
  );
}
