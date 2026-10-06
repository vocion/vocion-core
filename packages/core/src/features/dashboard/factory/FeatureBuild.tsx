'use client';

import type { ReactNode } from 'react';
import type { DotTone } from '@/components/patterns';
import { Hammer, Loader2, RotateCcw } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { StatusDot } from '@/components/patterns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client } from '@/libs/Orpc';

/**
 * A BUILD THIS PAGE JUST STARTED, which the server has not read yet.
 *
 * After Build it, the headline kept saying "Changes asked" above "Building —
 * queued" until a reload (backlog 032). `router.refresh()` is not the fix: the
 * server then hides the Build block and its Undo. So the button publishes what
 * it started and the headline reads it; Undo takes it back; a reload hands the
 * page to the server's own reading again.
 */
type Started = { planning: string | null };
const started = new Map<number, Started>();
const listeners = new Set<() => void>();

function setStarted(requestId: number, value: Started | null) {
  if (value) {
    started.set(requestId, value);
  } else {
    started.delete(requestId);
  }
  listeners.forEach(l => l());
}

function useStarted(requestId: number): Started | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => started.get(requestId) ?? null,
    () => null,
  );
}

/**
 * The page's headline and sentence, read as the server drew them unless this
 * page just started a build — then as that build.
 * @param props
 * @param props.requestId - The request.
 * @param props.tone - The server's dot.
 * @param props.headline - The server's headline.
 * @param props.sentence - The server's sentence — plain text, or the live
 * case's sentence with its date spliced in as `LocalDate` (the reader's own
 * calendar, not baked server-side — see `StatusBlock`).
 */
export function FeatureHeadline({ requestId, tone, headline, sentence }: { requestId: number; tone: DotTone; headline: string; sentence: ReactNode }) {
  const now = useStarted(requestId);
  const shown = now
    ? now.planning
      ? { tone: 'ink' as DotTone, headline: 'Planning', sentence: `${now.planning}. The build starts once the plan is approved.` }
      : { tone: 'ink' as DotTone, headline: 'Waiting for a worker', sentence: 'Queued for the engineer just now.' }
    : { tone, headline, sentence };
  return (
    <p className="max-w-prose text-[15px] leading-relaxed text-foreground" data-testid="report-headline">
      <StatusDot tone={shown.tone} label={<span className="font-semibold">{shown.headline}</span>} className="mr-2 align-baseline" />
      {shown.sentence && <span data-testid="report-status-sentence">{shown.sentence}</span>}
    </p>
  );
}

/**
 * BUILD IT, from the page (red team, 2026-09-26: the feature page offered
 * Dismiss and nothing else, so the only way to start a build was to go and
 * ask in chat). One tap files `factory.dispatch_task` for this request and
 * its plan and approves it as the person tapping: the contract comes from the
 * records, the plan is approved, the acceptance is frozen, the engineer is
 * queued. Undo while no worker has taken it.
 * @param props
 * @param props.requestId - The request.
 * @param props.planId - Its plan, when it has one.
 * @param props.children
 * @param props.label - What the button says: "Build it", "Approve build" or
 * "Build again" — the report's status decides (`featureReport.buildStatus`).
 * @param props.pendingRunId - A `factory.dispatch_task` card already waiting
 * for this request (the intake's Build card). Pressing Build approves THAT
 * card, so there is one card and the decision happens here, with Undo —
 * journey 4 left #4945 pending behind "Not being built" (2026-09-28).
 * @param props.disabledReason - Why a build would be refused right now
 * (`featureReport` reads it from the request's blocker): the button is drawn
 * disabled and the reason is its tooltip, so pressing it never just hits the
 * refusal (2026-10-01, #294).
 */
export function FeatureBuild({ requestId, planId, children, label = 'Build it', pendingRunId, disabledReason }: { requestId: number; planId: number | null; children?: React.ReactNode; label?: string; pendingRunId?: number; disabledReason?: string }) {
  const [phase, setPhase] = useState<{ s: 'idle' } | { s: 'working' } | { s: 'done'; runId: number; workerRunId: number | null; planning: string | null } | { s: 'error'; message: string }>({ s: 'idle' });

  const build = async () => {
    setPhase({ s: 'working' });
    try {
      const res = pendingRunId !== undefined
        ? { runId: pendingRunId, status: 'pending' }
        : await client.review.propose({
          actionId: 'factory.dispatch_task',
          input: { requestId, ...(planId ? { planId } : {}), reason: 'Build started from the feature page.' },
          rationale: 'The product owner pressed Build on the feature page.',
          confidence: 1,
          suggestedDecision: null,
          suggestedDecisionReason: null,
        }) as { runId: number; status: string };
      const decided = res.status === 'done' ? null : await client.review.decideAction({ id: res.runId, decision: 'approve' }) as { result?: { workerRunId?: number; planning?: boolean; why?: string } } | null;
      // Build is one path through the plan gate: when the rule needs a plan,
      // pressing Build starts planning and the approved plan builds itself.
      const planning = decided?.result?.planning ? (decided.result.why ?? 'the plan rule needs a plan first') : null;
      setPhase({ s: 'done', runId: res.runId, workerRunId: decided?.result?.workerRunId ?? null, planning });
      setStarted(requestId, { planning });
    } catch (err) {
      setPhase({ s: 'error', message: (err as Error).message });
    }
  };

  const undo = async (runId: number) => {
    setPhase({ s: 'working' });
    try {
      await client.review.undoAction({ id: runId });
      setPhase({ s: 'idle' });
      setStarted(requestId, null);
    } catch (err) {
      setPhase({ s: 'error', message: (err as Error).message });
    }
  };

  if (phase.s === 'done') {
    return (
      <p className="flex items-center gap-2 text-sm" data-testid="feature-building">
        <span className="size-1.5 rounded-full bg-brand-amber" aria-hidden />
        {/* The headline above now says what started; this line keeps the Undo. */}
        {phase.planning ? 'Planning started.' : 'Build started.'}
        <button type="button" onClick={() => void undo(phase.runId)} className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2 hover:text-foreground">
          <RotateCcw className="size-3.5" aria-hidden />
          Undo
        </button>
      </p>
    );
  }
  if (disabledReason) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            {/* aria-disabled, not disabled: a disabled button takes no pointer or focus, so its tooltip could never show. */}
            <button type="button" aria-disabled="true" onClick={e => e.preventDefault()} data-testid="feature-build-disabled" className="inline-flex h-9 cursor-not-allowed items-center gap-2 self-start rounded-md bg-foreground px-4 text-sm font-medium text-background opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Hammer className="size-4" aria-hidden />
              {label}
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{disabledReason}</TooltipContent>
        </Tooltip>
        {children}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void build()}
        disabled={phase.s === 'working'}
        data-testid="feature-build"
        className="inline-flex h-9 items-center gap-2 self-start rounded-md bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
      >
        {phase.s === 'working' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Hammer className="size-4" aria-hidden />}
        {phase.s === 'working' ? 'Starting…' : label}
      </button>
      {/* The quieter second action — Dismiss only while nothing has started. */}
      {children}
      {phase.s === 'error' && <p className="w-full text-xs text-[var(--brand-fail)]">{phase.message}</p>}
    </div>
  );
}
