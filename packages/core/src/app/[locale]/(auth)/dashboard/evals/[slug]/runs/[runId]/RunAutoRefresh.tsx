'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Pull the page again while the run is still going.
 *
 * The run starts before any case has finished — that is the whole point of the
 * refresh route — so without this the page someone lands on says "cases still
 * streaming" and never changes until they reload by hand.
 *
 * Polling rather than a socket: a run is minutes long, the payload is one
 * page, and a connection held open per viewer would cost more than it saves.
 * @param props - Props.
 * @param props.running - Whether the run is still in progress.
 * @param props.everyMs - How often to re-read. Defaults to five seconds.
 */
export function RunAutoRefresh({ running, everyMs = 5000 }: { running: boolean; everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [running, everyMs, router]);

  return null;
}
