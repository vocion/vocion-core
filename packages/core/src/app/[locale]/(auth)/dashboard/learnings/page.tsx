import { Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { TitleBar } from '@/features/dashboard/TitleBar';

/**
 * Placeholder shipped in v0.5.0 PR1. Full CRUD UI lands in PR4 — consumes
 * `services/LearningsService.ts` (listSteps, getLearnings, addLearning,
 * updateLearning, removeLearning, checkDedup). Backend is complete.
 * @param props
 * @param props.params
 */
export default async function LearningsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </div>
            <span>Learnings</span>
          </div>
        )}
        description="Whitelisted rule buckets the self-improver subagent feeds, gated by human approval."
      />
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Coming soon — list + CRUD UI (v0.5.0 PR4). Backend (
          <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">services/LearningsService.ts</code>
          ) ships today.
        </p>
      </div>
    </>
  );
}
