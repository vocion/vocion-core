'use client';

import { Loader2, PlayCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';

/**
 * Starts an eval run and goes straight to its page.
 *
 * POST /api/v1/evals/[slug]/refresh hands back a run id as soon as the
 * workflow is accepted, so the browser lands on a run page that says running
 * and fills in as the cases finish. Nobody sits on a spinner for the length of
 * a whole dataset any more.
 *
 * Same route the schedule uses, so a hand-pressed refresh and a scheduled one
 * produce the same rows.
 * @param root0 - Props.
 * @param root0.slug - Which dataset to run.
 */
export function RunDatasetButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/evals/${slug}/refresh`, { method: 'POST' });
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
                Starting…
              </>
            )
          : (
              <>
                <PlayCircle className="mr-2 size-4" />
                Run evals now
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
