'use client';

import type { ReactNode } from 'react';
import type { RunHeader, RunNow, RunStep, RunStepStatus, RunWhy } from '@/libs/worker/runLog';
import { CircleCheck, CircleDashed, CircleMinus, CircleX, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DetailMeta, StatusDot } from '@/components/patterns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/libs/I18nNavigation';
import { formatDuration, isLiveStatus } from '@/libs/worker/runLog';
import { cn } from '@/utils/Helpers';

/**
 * ONE HEADER FOR A RUN, on its page and in the preview pane (Chris,
 * 2026-09-30, run #435: both read "send-t275", the worker's own task id, and
 * the pane then printed the whole contract as a wall of text).
 *
 *   title        the feature the run builds, linking it
 *   status line  live dot · seat · attempt N of M · started · elapsed
 *   why          why this attempt: the CI failure, QA's send-back, the note
 *   now          the step it is on and the engineer's latest words
 *
 * The attempt count is the feature's own (`recovery.attemptOfRun`), so the
 * run and its feature never read two counters. The machine id moves into the
 * facts rows. The page adds the facts, the contract and the logs; the pane
 * adds the steps without their logs (`RunGlanceView`).
 */

const STOPPED = new Set(['failed', 'lost', 'cancelled']);

export function statusTone(status: string): 'pass' | 'amber' | 'fail' | 'neutral' | 'ink' {
  if (status === 'completed') {
    return 'pass';
  }
  if (status === 'failed' || status === 'lost') {
    return 'fail';
  }
  if (status === 'running') {
    return 'ink';
  }
  return status === 'paused' || status === 'awaiting_review' ? 'amber' : 'neutral';
}

export function statusLabel(status: string): string {
  return status === 'awaiting_review' ? 'Awaiting review' : status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * The run's elapsed time: to its end, or to now while it runs.
 * @param header - The run.
 * @param now - The clock.
 */
export function runElapsedMs(header: Pick<RunHeader, 'startedAt' | 'endedAt' | 'status'>, now: number): number | null {
  const started = header.startedAt ? Date.parse(header.startedAt) : null;
  const ended = header.endedAt ? Date.parse(header.endedAt) : null;
  const end = ended ?? (isLiveStatus(header.status) ? now : null);
  return started !== null && end !== null ? end - started : null;
}

/**
 * A clock that ticks each second while `live`.
 * @param live - Whether to tick.
 */
export function useRunClock(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) {
      return;
    }
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [live]);
  return now;
}

/**
 * When the run started, in the reader's own clock — "started 14:02", or with
 * the day when it was not today. The server renders UTC and the browser
 * replaces it after mount, as `LocalDate` does.
 * @param props
 * @param props.at - ISO.
 */
function StartedAt({ at }: { at: string }) {
  const d = new Date(at);
  const format = (zone?: string) => {
    const sameDay = new Date().toDateString() === d.toDateString();
    return new Intl.DateTimeFormat(undefined, { ...(sameDay ? {} : { day: 'numeric', month: 'short' }), hour: '2-digit', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) }).format(d);
  };
  const [text, setText] = useState(() => format('UTC'));
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect */
  useEffect(() => {
    setText(format());
  }, [at]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect */
  return <time dateTime={at}>{`started ${text}`}</time>;
}

/**
 * The run's title and its status line.
 * @param props
 * @param props.header - The run.
 * @param props.now - The clock, for the elapsed time.
 * @param props.refused - It was refused before it started.
 * @param props.compact - In the preview pane: its own header row carries the title, so this draws only the status line.
 * @param props.extra - More items at the end of the status line (the page's "live").
 */
export function RunTitleBlock({ header, now, refused = false, compact = false, extra }: { header: RunHeader; now: number; refused?: boolean; compact?: boolean; extra?: ReactNode }) {
  const live = isLiveStatus(header.status);
  const feature = header.context?.feature ?? null;
  const attempt = header.context?.attempt ?? null;
  const ms = runElapsedMs(header, now);
  return (
    <div data-testid="run-title-block">
      {!compact && (
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-1 shrink-0"><StepIcon status={runStepStatus(header.status)} large /></span>
          <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words text-foreground">
            {feature
              ? <Link href={feature.href} className="decoration-border underline-offset-4 hover:underline" data-testid="run-title-feature">{header.title}</Link>
              : header.title}
          </h1>
        </div>
      )}
      <DetailMeta
        className={compact ? 'mt-0' : undefined}
        items={[
          <StatusDot key="status" tone={statusTone(header.status)} label={statusLabel(header.status)} pulse={live} />,
          header.seat ? <span key="seat">{header.seat}</span> : null,
          attempt ? <span key="attempt" data-testid="run-attempt">{`attempt ${attempt.n} of ${attempt.of}`}</span> : null,
          header.startedAt && !refused ? <StartedAt key="started" at={header.startedAt} /> : null,
          refused
            ? <span key="took">Refused before it started</span>
            : ms !== null ? <span key="took" className="tabular-nums" data-testid="run-elapsed">{formatDuration(ms)}</span> : null,
          extra ?? null,
        ]}
      />
    </div>
  );
}

const WHY_LABEL: Record<RunWhy['kind'], string> = { ci: 'Why this attempt', review: 'Why this attempt', note: 'Asked of this attempt', recovery: 'Why this attempt' };

/**
 * WHY THIS ATTEMPT, in one line: the CI failure with the failing test and its
 * message, QA's send-back, or what the person asked. The whole line is one
 * hover away when it does not fit. Nothing on a first attempt.
 * @param props
 * @param props.why - From the run's records (`RunLogService.whyOfAttempt`).
 */
export function RunWhyLine({ why }: { why: RunWhy | null | undefined }) {
  if (!why) {
    return null;
  }
  const text = why.detail ? `${why.line} — ${why.detail}` : why.line;
  return (
    <div className="mt-2 flex min-w-0 items-baseline gap-2 text-[13px]" data-testid="run-why" data-why-kind={why.kind}>
      <span className="shrink-0 text-muted-foreground">{WHY_LABEL[why.kind]}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="min-w-0 flex-1 truncate text-left text-foreground">{text}</button>
        </TooltipTrigger>
        <TooltipContent className="max-w-md break-words whitespace-pre-wrap">{text}</TooltipContent>
      </Tooltip>
      {why.href && (
        <a href={why.href} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
          Last attempt
        </a>
      )}
    </div>
  );
}

/**
 * NOW, pinned above the steps while the run is live: the step it is on and
 * the engineer's latest commentary line, as the heartbeat brought it.
 * @param props
 * @param props.now - From `runNow`.
 */
export function RunNowLine({ now }: { now: RunNow | null }) {
  if (!now) {
    return null;
  }
  return (
    <div className="mt-3 flex min-w-0 items-start gap-2 rounded-md bg-surface-soft px-3 py-2 text-[13px]" data-testid="run-now" aria-live="polite">
      <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-foreground motion-reduce:animate-none" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{`Now · ${now.step}`}</span>
        {now.say && (
          <>
            <span className="text-muted-foreground"> — </span>
            <span className="break-words text-foreground" data-testid="run-now-say">{now.say}</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The steps as a runner lists them without their logs: a mark, a name, a
 * duration. The preview pane draws these; the page's rows open onto logs.
 * @param props
 * @param props.steps - The steps.
 * @param props.now - The clock, for a running step's duration.
 */
export function RunStepsCompact({ steps, now }: { steps: readonly RunStep[]; now: number }) {
  if (steps.length === 0) {
    return null;
  }
  return (
    <ol className="divide-y divide-rule" data-testid="run-steps-compact">
      {steps.map(step => (
        <li key={step.key} className="flex items-center gap-2.5 py-1.5 text-[13px]" data-item={step.key}>
          <StepIcon status={step.status} />
          <span className="min-w-0 flex-1 truncate text-foreground">{step.name}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">{stepDuration(step, now)}</span>
        </li>
      ))}
    </ol>
  );
}

export function runStepStatus(status: string): RunStepStatus {
  if (isLiveStatus(status)) {
    return status === 'queued' || status === 'planning' ? 'pending' : 'running';
  }
  if (status === 'completed') {
    return 'passed';
  }
  return STOPPED.has(status) ? 'failed' : 'pending';
}

export function stepDuration(step: RunStep, now: number): string {
  if (!step.startedAt) {
    return '';
  }
  const end = step.endedAt ? Date.parse(step.endedAt) : step.status === 'running' ? now : null;
  return end === null ? '' : formatDuration(end - Date.parse(step.startedAt));
}

const STATUS_WORD: Record<RunStepStatus, string> = { pending: 'Not started', running: 'Running', passed: 'Passed', failed: 'Failed', skipped: 'Skipped' };

export function StepIcon({ status, large }: { status: RunStepStatus; large?: boolean }) {
  const size = large ? 'size-5' : 'size-4';
  const icon: Record<RunStepStatus, ReactNode> = {
    pending: <CircleDashed className={cn(size, 'text-muted-foreground/60')} aria-hidden />,
    running: <LoaderCircle className={cn(size, 'animate-spin text-foreground motion-reduce:animate-none')} aria-hidden />,
    passed: <CircleCheck className={cn(size, 'text-brand-pass')} aria-hidden />,
    failed: <CircleX className={cn(size, 'text-brand-fail')} aria-hidden />,
    skipped: <CircleMinus className={cn(size, 'text-muted-foreground/60')} aria-hidden />,
  };
  return (
    <span className="inline-flex" data-step-status={status}>
      {icon[status]}
      <span className="sr-only">{STATUS_WORD[status]}</span>
    </span>
  );
}
