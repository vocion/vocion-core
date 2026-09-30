'use client';

import { Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { announceVersionWritten } from '@/features/dashboard/versions/versionEvents';
import { client } from '@/libs/Orpc';

/**
 * UNDO, WHERE THE LINE IS READ — one button for an action run a record's line
 * names: a duplicate link the check wrote, a deploy the pipeline started, a
 * rollback it opened (backlog 044, 049). The run's own undo does the work
 * (`review.undoAction`), and every surface drawing the record re-reads.
 * @param props
 * @param props.recordId - The record the line is on.
 * @param props.runId - The run to undo.
 * @param props.testId - The test id, per surface.
 */
export function UndoRun({ recordId, runId, testId }: { recordId: number; runId: number; testId: string }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null; done: boolean }>({ busy: false, error: null, done: false });
  const undo = async () => {
    setState({ busy: true, error: null, done: false });
    try {
      await client.review.undoAction({ id: runId });
      // Undo is a write to the record: every surface drawing it re-reads.
      announceVersionWritten({ ref: { type: 'object', id: String(recordId) }, from: null, to: 0 });
      setState({ busy: false, error: null, done: true });
    } catch (err) {
      setState({ busy: false, error: (err as Error).message, done: false });
    }
  };
  if (state.done) {
    return <span className="shrink-0 text-muted-foreground" data-testid={`${testId}-done`}>Undone</span>;
  }
  return (
    <>
      <button type="button" disabled={state.busy} onClick={() => void undo()} className="inline-flex shrink-0 items-center gap-1 text-foreground underline underline-offset-2" data-testid={testId}>
        {state.busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RotateCcw className="size-3" aria-hidden />}
        Undo
      </button>
      {state.error && <span className="basis-full text-destructive" data-testid={`${testId}-error`}>{`Could not undo: ${state.error}`}</span>}
    </>
  );
}
