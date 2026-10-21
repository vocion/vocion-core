'use client';

/**
 * WHAT A BROWSER RUN FOUND, UNDER THE ANSWER THAT ASKED FOR IT — the run's own
 * outputs, read from the run and drawn by the same component the pane uses
 * (`OutputValue`), in the order the run read them off the page.
 *
 * Why (2026-10-21): the agent restated a run's rows in its own words and in
 * a different order from the page; the pane was right and the answer was not.
 * The rows are the run's, so the run draws them, and the agent is told they
 * are drawn (`browser_task`'s note) and to say what matters instead of
 * copying them. One table per run, one source.
 */

import type { BrowserRunView } from '@/libs/browser/run';
import { Globe } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openPreview } from '@/features/preview/previewState';
import { browserRunLabel } from '@/libs/browser/run';
import { client } from '@/libs/Orpc';
import { OutputValue } from './OutputValue';

export function BrowserRunResult({ runId }: { runId: number }) {
  const [run, setRun] = useState<BrowserRunView | null>(null);
  useEffect(() => {
    let stop = false;
    void client.browser.get({ id: runId })
      .then((j) => {
        if (!stop && j.run) {
          setRun(j.run);
        }
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [runId]);
  const outputs = Object.entries(run?.result ?? {});
  if (!run || run.status !== 'done' || outputs.length === 0) {
    return null;
  }
  return (
    <section className="mt-3 space-y-3 rounded-lg border border-border/70 bg-background/60 p-3" data-browser-result-card={runId}>
      <button type="button" onClick={ev => openPreview({ type: 'browser_run', id: String(runId) }, ev.currentTarget)} className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground">
        <Globe className="size-3" aria-hidden />
        {`From ${browserRunLabel(runId)}`}
      </button>
      {outputs.map(([k, v]) => (
        <div key={k}>
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{k.replace(/_/g, ' ')}</p>
          <OutputValue value={v} />
        </div>
      ))}
    </section>
  );
}
