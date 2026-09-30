'use client';

import type { RunGlance } from '@/libs/worker/runLog';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLive } from '@/hooks/useLive';
import { Link } from '@/libs/I18nNavigation';
import { liveTopic } from '@/libs/live/topics';
import { client } from '@/libs/Orpc';
import { isLiveStatus, refusedBeforeStart } from '@/libs/worker/runLog';
import { RunNowLine, RunStepsCompact, RunTitleBlock, RunWhyLine, useRunClock } from './RunHeader';

/** How often the pane re-reads a live run. */
export const GLANCE_POLL_MS = 4000;

/**
 * A RUN IN THE PREVIEW PANE, in its page's own shape (Chris, 2026-09-30: the
 * pane read "#435 · running · claude" and then the whole contract as a wall
 * of text, while the page had steps and a live log). The same status line,
 * why this attempt and Now line as the page (`RunHeader`), then the steps as
 * a runner lists them without their logs, then the moves out: the run's
 * page, its pull request and its contract. The pane's own header row carries
 * the title.
 *
 * While the run is live, each heartbeat and status change arrives on the
 * live stream (`useLive`, the run's own topic, as its page follows it) and
 * the pane re-reads the glance whole; while the stream is down it asks every
 * few seconds instead (tab visible). A finished run is not read again.
 * @param props
 * @param props.initial - The run as the preview read it.
 * @param props.pollMs - How often to re-read while live; {@link GLANCE_POLL_MS} unless a test says otherwise.
 */
export function RunGlanceView({ initial, pollMs = GLANCE_POLL_MS }: { initial: RunGlance; pollMs?: number }) {
  const [glance, setGlance] = useState(initial);
  const { header } = glance;
  const live = isLiveStatus(header.status);
  const visible = useSyncExternalStore(subscribeVisibility, readVisible, () => true);
  const now = useRunClock(live);

  // One read of the glance; a read already out is not doubled.
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reread = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      const next = await client.runs.glance({ ref: header.ref });
      if (alive.current) {
        setGlance(next as RunGlance);
      }
    } catch {
      // A missed read is caught up by the next one.
    } finally {
      inFlight.current = false;
    }
  }, [header.ref]);

  // Pushed (backlog 050): every heartbeat that lands an engineering run's new
  // lines, and every change of its status, is a notice on the run's topic —
  // the same one its page follows. An agent run publishes nothing of its own,
  // so it keeps asking on the interval.
  const { live: pushed } = useLive(live && header.kind === 'worker' ? [liveTopic.run(header.id)] : [], () => void reread());

  // The fallback while the stream is down: ask every few seconds.
  useEffect(() => {
    if (!live || !visible || pushed) {
      return;
    }
    const timer = setInterval(() => void reread(), pollMs);
    return () => clearInterval(timer);
  }, [live, visible, pushed, reread, pollMs]);

  const refused = refusedBeforeStart({ header, events: [], tasks: [], calls: [], cursor: 0 });
  const runHref = header.kind === 'agent' ? `/dashboard/p/runs/agent-${header.id}` : `/dashboard/p/runs/${header.id}`;
  const out = 'text-[13px] text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground';
  return (
    <div data-testid="run-glance" data-live={live && visible ? 'on' : 'off'}>
      <RunTitleBlock header={header} now={now} refused={refused} compact />
      <RunWhyLine why={header.context?.why} />
      <RunNowLine now={glance.now} />
      {glance.steps.length > 0 && (
        <div className="mt-4 border-t border-rule pt-2">
          <RunStepsCompact steps={glance.steps} now={now} />
        </div>
      )}
      <nav className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule pt-3" aria-label="Open">
        <Link href={runHref} className={out} data-testid="run-glance-open">Open run ›</Link>
        {header.prUrl && <a href={header.prUrl} target="_blank" rel="noopener noreferrer" className={out} data-testid="run-glance-pr">Pull request</a>}
        {header.objective && <Link href={`${runHref}#contract`} className={out} data-testid="run-glance-contract">Contract ›</Link>}
        {header.context?.feature && <Link href={header.context.feature.href} className={out} data-testid="run-glance-feature">Feature ›</Link>}
      </nav>
    </div>
  );
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function readVisible(): boolean {
  return document.visibilityState !== 'hidden';
}
