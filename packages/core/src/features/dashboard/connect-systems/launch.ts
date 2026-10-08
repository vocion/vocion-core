'use client';

import type { ConnectPlanInput } from '@/libs/connect/systemsPlan';
import { useCallback, useEffect, useState } from 'react';

/**
 * Starting "Connect your systems" on whichever chat surface is mounted: a card
 * in the transcript, or anything else on the page, dispatches one event and
 * the surface docks the walk-through above its composer. One walk at a time:
 * a second start replaces the first.
 */

export const CONNECT_SYSTEMS_EVENT = 'vocion:connect-systems';
/** The walk finished: its card shows the summary at once, as a reload will from the stored card. */
export const CONNECT_SYSTEMS_FINISHED_EVENT = 'vocion:connect-systems-finished';

export type ConnectSystemsLaunch = {
  input: ConnectPlanInput;
  /** The chat card that offered it, so its summary lands there. */
  cardId?: string;
};

/**
 * Ask the mounted chat surface to start the walk-through.
 * @param launch - What to plan, and the card it came from.
 */
export function startConnectSystems(launch: ConnectSystemsLaunch): void {
  window.dispatchEvent(new CustomEvent<ConnectSystemsLaunch>(CONNECT_SYSTEMS_EVENT, { detail: launch }));
}

/**
 * Tell the card that started a walk what became of it.
 * @param cardId - The card.
 * @param summary - Its one line.
 */
export function announceConnectSystemsFinished(cardId: string, summary: string): void {
  window.dispatchEvent(new CustomEvent(CONNECT_SYSTEMS_FINISHED_EVENT, { detail: { cardId, summary } }));
}

/**
 * The surface's half: the walk in progress (or null), started by the event or
 * by `initial` (a link that named the objective), and a way to close it.
 * @param initial - A walk to start with, from the page's address.
 */
export function useConnectSystems(initial: ConnectSystemsLaunch | null = null) {
  const [active, setActive] = useState<(ConnectSystemsLaunch & { key: number }) | null>(null);
  // A link followed while the chat is already open re-renders this surface
  // with a new `initial` rather than mounting it: start on each new one.
  const initialKey = initial ? JSON.stringify(initial) : null;
  useEffect(() => {
    if (initialKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- the address named a walk: start it
      setActive(prev => ({ ...(JSON.parse(initialKey) as ConnectSystemsLaunch), key: (prev?.key ?? 0) + 1 }));
    }
  }, [initialKey]);
  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<ConnectSystemsLaunch>).detail;
      if (detail?.input) {
        setActive(prev => ({ ...detail, key: (prev?.key ?? 0) + 1 }));
      }
    };
    window.addEventListener(CONNECT_SYSTEMS_EVENT, onStart);
    return () => window.removeEventListener(CONNECT_SYSTEMS_EVENT, onStart);
  }, []);
  const close = useCallback(() => setActive(null), []);
  return { active, close };
}
