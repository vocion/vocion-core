'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client } from '@/libs/Orpc';

export function MissionRunActions({ runId, status }: { runId: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [promoted, setPromoted] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const awaitingReview = status === 'awaiting_review' || status === 'paused';
  const active = status === 'running' || status === 'planning' || awaitingReview;
  const done = status === 'completed';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {awaitingReview && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => client.missions.resume({ id: runId }))}
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          Approve &amp; continue
        </button>
      )}
      {active && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => client.missions.cancel({ id: runId }))}
          className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
        >
          Cancel
        </button>
      )}
      {done && !promoted && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(async () => {
            const r = await client.missions.promote({ id: runId });
            setPromoted(r.slug);
          })}
          className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
        >
          Promote to workflow
        </button>
      )}
      {done && (
        <>
          <button type="button" disabled={busy} onClick={() => act(() => client.missions.submitFeedback({ id: runId, rating: 'up' }))} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm transition hover:bg-muted disabled:opacity-50">👍</button>
          <button type="button" disabled={busy} onClick={() => act(() => client.missions.submitFeedback({ id: runId, rating: 'down' }))} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm transition hover:bg-muted disabled:opacity-50">👎</button>
        </>
      )}
      {promoted && (
        <span className="text-sm text-muted-foreground">
          Drafted workflow
          <code className="font-mono">{promoted}</code>
          {' '}
          — refine it before activating.
        </span>
      )}
    </div>
  );
}
