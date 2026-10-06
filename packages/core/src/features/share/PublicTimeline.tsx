'use client';

import type { PublicStep } from '@/services/factory/featureShare';
import { useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** One step's clock: "9:45 AM", and its day when the day changes from the step before. */
export type StepClock = { time: string; day: string | null };

/**
 * The steps' times in one zone, simplified: the time of day on every step,
 * the date only on the first and where the day changes ("2 Oct" then "9:45
 * AM", "10:03 AM", … "3 Oct", "8:12 AM").
 * @param steps - The steps, oldest first.
 * @param timeZone - The zone; the reader's own when omitted.
 */
export function stepClock(steps: ReadonlyArray<Pick<PublicStep, 'at'>>, timeZone?: string): StepClock[] {
  const zone = timeZone ? { timeZone } : {};
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...zone });
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...zone });
  let last: string | null = null;
  return steps.map((s) => {
    const d = new Date(s.at);
    const today = day.format(d);
    const changed = today !== last;
    last = today;
    return { time: time.format(d), day: changed ? today : null };
  });
}

/**
 * THE TIMELINE, AT A GLANCE (Chris, 2026-10-03: "simplified timestamps, run
 * time, and a little sentence explaining"). Each step: its time of day (its
 * date only when the day changes), how long until the next step, and one
 * plain sentence. The server draws the times in UTC — it cannot know the
 * reader's zone — and the browser redraws them in the reader's own.
 * @param props
 * @param props.steps - The steps, oldest first.
 */
export function PublicTimeline({ steps }: { steps: readonly PublicStep[] }) {
  const [clock, setClock] = useState(() => stepClock(steps, 'UTC'));
  /* eslint-disable react-hooks-extra/no-direct-set-state-in-use-effect */
  useEffect(() => {
    setClock(stepClock(steps));
  }, [steps]);
  /* eslint-enable react-hooks-extra/no-direct-set-state-in-use-effect */
  return (
    <ol className="min-w-0" data-testid="public-steps">
      {steps.map((s, i) => (
        <li key={`${s.step}-${s.at}`} className="relative grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0" data-testid="public-step">
          <div className="text-right text-[13px] leading-snug text-muted-foreground tabular-nums">
            {clock[i]?.day && <span className="block text-[11px] font-semibold tracking-[0.06em] text-foreground uppercase" data-testid="public-step-day">{clock[i]!.day}</span>}
            <time dateTime={s.at} className="whitespace-nowrap" data-testid="public-step-time">{clock[i]?.time}</time>
          </div>
          <div className="min-w-0 border-l border-border pl-3">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[15px] leading-snug">
              <span className="font-medium break-words text-foreground" data-testid="public-step-name">{s.step}</span>
              {s.took && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[12px] whitespace-nowrap text-muted-foreground tabular-nums">
                      <span data-testid="public-step-took">{s.took}</span>
                      <span className="sr-only"> until the next step</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{`${s.took} until the next step`}</TooltipContent>
                </Tooltip>
              )}
            </p>
            {s.sentence && <p className="mt-0.5 text-[13px] leading-snug break-words text-muted-foreground" data-testid="public-step-sentence">{s.sentence}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
