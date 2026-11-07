'use client';

/**
 * A BATCH, KEPT CURRENT — the one read every surface showing a batch uses: the
 * queue on its page and in the pane (`RoutineBatchView`) and the live table
 * under the answer that started it (`RoutineBatchTable`).
 *
 * Re-read every `fastMs` while the batch runs and the tab is shown (a run's
 * current step moves on its browser run, which says nothing on the batch's
 * topic), at once on a live notice (`routine-batch:<id>`), and every
 * `settledMs` after it ends, or never when that is null. A new question for
 * the expert, a finding, or the batch's end is said in the conversation it was
 * asked from (a docked Decision, a closing message): the open chat is told to
 * read it again.
 */

import type { RoutineBatchView as RoutineBatch } from '@/libs/routines/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { announceConversationAppended } from '@/features/dashboard/chat/conversationAppended';
import { useLive } from '@/hooks/useLive';
import { client } from '@/libs/Orpc';

const BATCH_FAST_MS = 1500;
const BATCH_SLOW_MS = 10_000;

/**
 * The batch, read and re-read.
 * @param id - The batch.
 * @param initial - What the server already read, or null to read it now.
 * @param opts - Cadence.
 * @param opts.fastMs - While it runs.
 * @param opts.settledMs - After it ends; null stops reading (live notices still re-read it).
 */
export function useRoutineBatch(id: number, initial: RoutineBatch | null, opts: { fastMs?: number; settledMs?: number | null } = {}): [RoutineBatch | null, (b: RoutineBatch) => void] {
  const fastMs = opts.fastMs ?? BATCH_FAST_MS;
  const settledMs = opts.settledMs === undefined ? BATCH_SLOW_MS : opts.settledMs;
  const [batch, setBatch] = useState<RoutineBatch | null>(initial);
  const running = useRef(initial === null || initial.status === 'running');
  running.current = batch === null || batch.status === 'running';
  const inflight = useRef(false);
  const pull = useCallback(async () => {
    if (inflight.current) {
      return;
    }
    inflight.current = true;
    try {
      const res = await client.routines.batch({ id });
      if (res.batch) {
        // Before the render, so the loop's next wait already knows the batch ended.
        running.current = res.batch.status === 'running';
        setBatch(res.batch);
      }
    } catch {
      /* the next pull tries again */
    } finally {
      inflight.current = false;
    }
  }, [id]);

  const hasInitial = initial !== null;
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => (running.current ? fastMs : settledMs);
    const loop = async () => {
      if (!document.hidden) {
        await pull();
      }
      const wait = next();
      if (!stop && wait !== null) {
        timer = setTimeout(loop, wait);
      }
    };
    timer = setTimeout(loop, hasInitial ? fastMs : 0);
    const onShown = () => {
      if (!document.hidden && !stop) {
        clearTimeout(timer);
        // A settled batch that stopped reading is read once more on return, and stays stopped.
        if (next() === null) {
          void pull();
        } else {
          void loop();
        }
      }
    };
    document.addEventListener('visibilitychange', onShown);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShown);
    };
  }, [pull, fastMs, settledMs, hasInitial]);

  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLive([`routine-batch:${id}`], () => {
    if (soon.current) {
      return;
    }
    soon.current = setTimeout(() => {
      soon.current = null;
      void pull();
    }, 200);
  });
  useEffect(() => () => {
    if (soon.current) {
      clearTimeout(soon.current);
    }
  }, []);

  const said = useRef<string>('');
  const ask = batch ? [batch.status, ...batch.runs.map(r => r.waiting?.askId ?? 0), ...batch.findings.map(f => `${f.id}:${f.state}`)].join(',') : '';
  const conversationId = batch?.conversationId ?? null;
  useEffect(() => {
    if (said.current && ask && said.current !== ask && conversationId) {
      announceConversationAppended(conversationId);
    }
    if (ask) {
      said.current = ask;
    }
  }, [ask, conversationId]);
  return [batch, setBatch];
}
