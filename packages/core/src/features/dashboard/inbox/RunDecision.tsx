'use client';

import type { InboxRefKind } from '@/services/inbox/inboxRef';
import { ArrowLeft, ArrowUpRight, Play, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { StickyActionBar } from '@/features/dashboard/StickyActionBar';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { shortcutFor } from '@/features/review/reviewShortcuts';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { DECISION_VERBS, verbForShortcut } from './decisionVerbs';
import { decisionCrumbs } from './inboxMeta';
import { withMinimumPending } from './pending';

/** What the compact run screen needs to know — the server page hands it over. */
export type RunSummary = {
  kind: Extract<InboxRefKind, 'mission' | 'workflow' | 'worker'>;
  id: number;
  title: string;
  status: string;
  /** Why it stopped — the pause reason, the error, the gate. */
  reason: string | null;
  agentSlug: string | null;
  /** The run's own page — the full record. */
  openHref: string;
  openLabel: string;
  facts: Array<{ label: string; value: string }>;
  /** Whether Resume / Cancel exist for this kind. A worker run only opens. */
  actionable: boolean;
};

/**
 * The `run` kind's decision screen: a compact status page with the same
 * chrome as every other decision — breadcrumb, H1, meta row — a few facts,
 * the reason it stopped, and Resume / Cancel in the sticky bar. Resume and
 * Cancel go through the same oRPC routes the run pages use
 * (`missions.resume` / `missions.cancel`, `review.resumeWorkflow` /
 * `review.cancelWorkflow`), so nothing here can do what those cannot. The
 * full record is one click away.
 * @param props
 * @param props.run
 */
export function RunDecision({ run }: { run: RunSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'resume' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const verbs = DECISION_VERBS.run;

  async function act(verb: 'resume' | 'cancel') {
    setBusy(verb);
    setError(null);
    try {
      const work: Promise<unknown> = run.kind === 'mission'
        ? (verb === 'resume' ? client.missions.resume({ id: run.id }) : client.missions.cancel({ id: run.id }))
        : run.kind === 'workflow'
          ? (verb === 'resume' ? client.review.resumeWorkflow({ id: run.id }) : client.review.cancelWorkflow({ id: run.id }))
          : Promise.resolve();
      await withMinimumPending(work);
      toast.success(`${verb === 'resume' ? 'Resumed' : 'Cancelled'} · ${run.title}`, {
        description: verb === 'resume' ? 'The run continues from where it paused.' : 'Stopped; nothing more runs.',
      });
      // Stay on the run and re-read it: its new status is the receipt, and
      // the way back is a link the person presses.
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Could not ${verb} · ${run.title}`, { description: message });
      // Someone else may have resolved this run already — re-read it.
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const stopped = ['failed', 'lost', 'cancelled', 'completed'].includes(run.status);

  // `a` resumes, `d` cancels — the same keys the bar shows. Never while typing.
  useEffect(() => {
    if (!run.actionable || stopped) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null });
      const verb = action ? verbForShortcut('run', action) : null;
      if (!verb || busy) {
        return;
      }
      e.preventDefault();
      void act(verb.id === 'resume' ? 'resume' : 'cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="mx-auto w-full max-w-3xl" data-testid="run-decision">
      <ReviewHeader
        crumbs={decisionCrumbs('run', run.title)}
        title={run.title}
        system={run.kind === 'mission' ? 'Mission run' : run.kind === 'workflow' ? 'Workflow run' : 'Worker run'}
        status={run.status}
        proposedBy={run.agentSlug ? `led by ${run.agentSlug}` : null}
      />

      {run.reason && (
        <section className="border-b border-rule py-6">
          <div className="text-[11px] font-medium text-muted-foreground">{stopped ? 'What went wrong' : 'Why it is waiting'}</div>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed break-words text-foreground/80">{run.reason}</p>
        </section>
      )}

      <section className="border-b border-rule py-6">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {run.facts.map(f => (
            <div key={f.label} className="flex justify-between gap-4 border-b border-rule/60 py-1.5 last:border-0 sm:border-0 sm:py-0">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="text-right tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
        <Link href={run.openHref} className="mt-4 inline-flex items-center gap-1 text-sm font-medium underline decoration-border underline-offset-4 transition hover:decoration-foreground">
          {run.openLabel}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </section>

      {error && (
        <div role="alert" className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {run.actionable && !stopped
        ? (
            <StickyActionBar
              primary={{ 'label': verbs.primary.label, 'onClick': () => void act('resume'), 'disabled': busy !== null, 'busy': busy === 'resume', 'icon': Play, 'shortcut': verbs.primary.shortcut, 'data-testid': 'run-resume' }}
              secondary={verbs.secondary.map(v => ({ 'label': v.label, 'onClick': () => void act('cancel'), 'disabled': busy !== null, 'busy': busy === 'cancel', 'icon': X, 'shortcut': v.shortcut, 'tone': v.tone, 'data-testid': 'run-cancel' }))}
            />
          )
        : (
            <StickyActionBar
              primary={{ label: run.openLabel, onClick: () => router.push(run.openHref), icon: ArrowUpRight }}
              secondary={[{ 'label': 'Back to the review queue', 'onClick': () => router.push('/dashboard/inbox?kind=run'), 'icon': ArrowLeft, 'data-testid': 'run-back' }]}
            />
          )}
    </div>
  );
}
