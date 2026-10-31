'use client';

import { useState, useTransition } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { useRouter } from '@/libs/I18nNavigation';

/**
 * Explicit refresh of observed client outcomes; no credentials are touched at render time.
 * @param root0
 * @param root0.projectId
 * @param root0.revision
 * @param root0.canEdit
 */
export function SeoMeasurementActions({ projectId, revision, canEdit }: { projectId: number; revision: number; canEdit: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="space-y-3 rounded-xl border border-border p-5">
      <h2 className="font-semibold">Measure and report</h2>
      <p className="text-sm text-muted-foreground">Capture the latest complete 28-day Search Console window. The first capture establishes the baseline; later captures preserve it. Publication is tracked separately from clicks and leads.</p>
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            className={buttonVariants({ variant: 'outline' })}
            onClick={() => start(async () => {
              setError(null);
              try {
                const res = await fetch(`/api/v1/seo/projects/${projectId}/measurement`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: revision }) });
                const body = await res.json();
                if (!res.ok) {
                  throw new Error(body.error?.message || 'Measurement could not be captured.');
                }
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            })}
          >
            {busy ? 'Reading Search Console…' : 'Capture search measurements'}
          </button>
        )}
        <a href={`/api/v1/seo/projects/${projectId}/measurement`} className={buttonVariants({ variant: 'outline' })}>Download client progress report</a>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
