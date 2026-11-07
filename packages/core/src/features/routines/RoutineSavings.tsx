'use client';

/**
 * WHAT IT SAVED — the conclusion a batch or an automation leads with ("Saved
 * 31 hours this month, $2,480 of specialist time, for $41 of runs"), with how
 * each number is worked out one click away, and the week-by-week trend drawn
 * by the one chart engine. Read from `libs/routines/savings.ts`; with no
 * baseline there is no saving to state and nothing here renders (the cost
 * stays in the figures beside it).
 */

import type { RoutineSavingsView, Savings } from '@/libs/routines/savings';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChartView } from '@/libs/charts/ChartView';
import { dayLabel, hasSaving, savingMethod, savingSentence } from '@/libs/routines/savings';

/**
 * The conclusion and, behind "How", how it is worked out.
 * @param props
 * @param props.savings - The reading.
 * @param props.when - The period, as words after the time ("this month"), or none.
 */
export function SavingLine({ savings, when }: { savings: Savings; when?: string | null }) {
  const sentence = savingSentence(savings, when);
  if (!sentence) {
    return null;
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] leading-snug font-medium text-foreground" data-routine-saving>
      <span>{sentence}</span>
      <Popover>
        <PopoverTrigger className="text-[12px] font-normal text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground" data-routine-saving-how>
          How it’s worked out
        </PopoverTrigger>
        <PopoverContent className="w-[24rem] max-w-[calc(100vw-2rem)] p-3" align="start">
          <ul className="space-y-1.5 text-[13px] leading-snug text-foreground">
            {savingMethod(savings).map(l => <li key={l}>{l}</li>)}
          </ul>
        </PopoverContent>
      </Popover>
    </p>
  );
}

/**
 * An automation over time: the conclusion for this month (else the trend's weeks), and the weeks as
 * bars: hours saved where there is a baseline, what the runs cost where there is not.
 * @param props
 * @param props.view - The automation's savings.
 */
export function SavingsOverTime({ view }: { view: RoutineSavingsView }) {
  if (view.total.runs === 0) {
    return null;
  }
  const weeks = view.weeks.length;
  const saving = view.weeks.some(w => hasSaving(w.savings));
  const x = view.weeks.map(w => w.label);
  const spec = saving
    ? { title: 'Hours saved each week', type: 'bar' as const, x, series: [{ name: 'Hours saved', values: view.weeks.map(w => (w.savings.savedMinutes === null ? 0 : Math.round((w.savings.savedMinutes / 60) * 10) / 10)) }], format: 'number' as const, unit: 'hours', partialLast: true }
    : { title: 'What the runs cost each week', type: 'bar' as const, x, series: [{ name: 'Run cost', values: view.weeks.map(w => w.savings.costCents / 100) }], format: 'currency' as const, partialLast: true };
  return (
    <div className="space-y-4" data-routine-savings>
      {hasSaving(view.month)
        ? <SavingLine savings={view.month} when="this month" />
        : <SavingLine savings={view.recent} when={`in the last ${weeks} weeks`} />}
      {view.recent.runs > 0 && <ChartView spec={spec} dense />}
      {view.sampleBefore && <p className="text-[12px] text-muted-foreground">{`Sample history before ${dayLabel(view.sampleBefore)}`}</p>}
    </div>
  );
}
