'use client';

import { Loader2, PlayCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';

/**
 * Kicks off an eval run via POST /api/v1/evals/[slug]/runs and redirects
 * to the run-detail page when the run completes. Long-running by nature
 * (each case = LLM generation + LLM judge); the server route awaits the
 * full execution today, so the spinner stays until the metrics land. A
 * future iteration can split kickoff from completion polling.
 * @param root0
 * @param root0.slug
 */
export function RunDatasetButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/evals/${slug}/runs`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      const { runId } = await res.json();
      router.push(`/dashboard/evals/${slug}/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-2">
      <button type="button" disabled={running} onClick={onClick} className={buttonVariants()}>
        {running
          ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Running…
              </>
            )
          : (
              <>
                <PlayCircle className="mr-2 size-4" />
                Run dataset
              </>
            )}
      </button>
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
