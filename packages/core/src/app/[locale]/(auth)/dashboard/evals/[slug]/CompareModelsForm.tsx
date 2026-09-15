'use client';

import { ArrowRight, GitCompareArrows, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { cn } from '@/utils/Helpers';

/**
 * The "Compare models" affordance on a dataset: name the model the role runs
 * on today and the release you want to test, and the dataset runs on both.
 * POSTs `/api/v1/evals/[slug]/model-upgrade-test` and lands on the compare
 * view when both runs are in. Both runs execute inside the request today
 * (same trade-off as RunDatasetButton), so the spinner is honest about the
 * wait — two runs, every case judged.
 * @param props
 * @param props.slug - The dataset slug.
 * @param props.defaultBaseline - Prefill for the baseline model.
 * @param props.defaultCandidate - Prefill for the candidate model.
 */
export function CompareModelsForm({ slug, defaultBaseline = '', defaultCandidate = '' }: { slug: string; defaultBaseline?: string; defaultCandidate?: string }) {
  const router = useRouter();
  const [baseline, setBaseline] = useState(defaultBaseline);
  const [candidate, setCandidate] = useState(defaultCandidate);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = baseline.trim().length > 0 && candidate.trim().length > 0 && baseline.trim() !== candidate.trim();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) {
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/evals/${slug}/model-upgrade-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baselineModel: baseline.trim(), candidateModel: candidate.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      const { baselineRunId, candidateRunId } = await res.json();
      router.push(`/dashboard/evals/${slug}/compare?baseline=${baselineRunId}&candidate=${candidateRunId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  const field = 'h-8 w-44 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

  return (
    <form onSubmit={onSubmit} className="inline-flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <GitCompareArrows className="size-4 text-muted-foreground" aria-hidden />
        <label className="sr-only" htmlFor={`baseline-${slug}`}>Baseline model</label>
        <input
          id={`baseline-${slug}`}
          className={field}
          placeholder="baseline, e.g. gpt-5.6-sol"
          value={baseline}
          onChange={e => setBaseline(e.target.value)}
          disabled={running}
          autoComplete="off"
          spellCheck={false}
        />
        <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
        <label className="sr-only" htmlFor={`candidate-${slug}`}>Candidate model</label>
        <input
          id={`candidate-${slug}`}
          className={field}
          placeholder="candidate, e.g. gpt-6-astra"
          value={candidate}
          onChange={e => setCandidate(e.target.value)}
          disabled={running}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={!ready || running} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          {running
            ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  Running both…
                </>
              )
            : 'Compare models'}
        </button>
      </div>
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </form>
  );
}
