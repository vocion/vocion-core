import { TestTube } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { TitleBar } from '@/features/dashboard/TitleBar';

/**
 * Placeholder shipped in v0.5.0 PR1. The real list + dataset detail +
 * run detail pages land in PR3 — they consume `services/EvalService.ts`
 * (listDatasets, getDataset, runDataset, listRuns, getRun). Backend is
 * complete.
 * @param props
 * @param props.params
 */
export default async function EvalsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TestTube className="size-5" />
            </div>
            <span>Evals</span>
          </div>
        )}
        description="Scored datasets per agent. Run, judge, compare across prompt versions."
      />
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Coming soon — list + dataset detail + run detail (v0.5.0 PR3).
          Backend (
          <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">services/EvalService.ts</code>
          ) ships today.
        </p>
      </div>
    </>
  );
}
