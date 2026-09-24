'use client';

import type { EvalPeriodId } from './evalPeriod';
import type { DateRange, ScorecardPreset } from '@/features/scorecard/periods';
import { CalendarRange } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CustomRangeForm } from '@/features/scorecard/CustomRangeForm';
import { describeRange, rangeForPreset } from '@/features/scorecard/periods';
import { MAX_RUN_RANGE_DAYS } from '@/libs/evals/runRange';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { EVAL_PERIOD_PRESETS, initialCustomRange, isStalePreset, periodHref } from './evalPeriod';

/**
 * The dataset page's period picker: the scorecard's preset dropdown and
 * custom-range popover, driving the URL instead of local state.
 *
 * The page is rendered on the server, so the period lives in the query string
 * and every change is a navigation — which also makes a filtered view a link
 * someone can send. The chart, the summary numbers and the run list all read
 * that one query string, so they cannot drift apart.
 */

const CUSTOM_OPTION = 'custom';

type Router = ReturnType<typeof useRouter>;

/** What a period change needs to build the next URL and go there. */
type Navigation = { router: Router; pathname: string; query: string };

/**
 * Go to the dataset page for a new period, keeping the scroll position so
 * the picker stays under the pointer.
 * @param navigation - The router and the URL now.
 * @param period - The period to switch to.
 * @param range - Its range; null for all time.
 */
function goToPeriod(navigation: Navigation, period: EvalPeriodId, range: DateRange | null): void {
  navigation.router.push(periodHref(navigation.pathname, new URLSearchParams(navigation.query), period, range), { scroll: false });
}

/**
 * The dropdown's choice: a preset navigates to its range; "Custom range…"
 * opens the popover and leaves the period alone until a range is applied.
 * @param value - The selected option's value.
 * @param openCustom - Opens the custom-range popover.
 * @param navigation - The router and the URL now.
 */
function choosePeriodOption(value: string, openCustom: (open: boolean) => void, navigation: Navigation): void {
  if (value === CUSTOM_OPTION) {
    openCustom(true);
    return;
  }
  if (value === 'all') {
    goToPeriod(navigation, 'all', null);
    return;
  }
  const preset = value as ScorecardPreset;
  goToPeriod(navigation, preset, rangeForPreset(preset));
}

/**
 * Close the popover and go to the custom range that was applied.
 * @param range - The applied range.
 * @param openCustom - Closes the popover.
 * @param navigation - The router and the URL now.
 */
function applyCustomPeriod(range: DateRange, openCustom: (open: boolean) => void, navigation: Navigation): void {
  openCustom(false);
  goToPeriod(navigation, 'custom', range);
}

/**
 * What the date button says: the range in the viewer's own days, or "All time".
 * @param period - The period on screen.
 * @param from - The URL's `from`, ISO, or null.
 * @param to - The URL's `to`, ISO, or null.
 */
function periodLabel(period: EvalPeriodId, from: string | null, to: string | null): string {
  if (period === 'all') {
    return 'All time';
  }
  if (from && to) {
    return describeRange({ from: new Date(from), to: new Date(to) });
  }
  return 'Custom range';
}

/**
 * Re-resolve a preset whose range has gone stale in the viewer's timezone,
 * replacing the history entry so Back does not step through the correction.
 * @param navigation - The router and the URL now.
 * @param period - The period in the URL.
 * @param from - The URL's `from`, ISO, or null.
 * @param to - The URL's `to`, ISO, or null.
 */
function replaceStalePreset(navigation: Navigation, period: EvalPeriodId, from: string | null, to: string | null): void {
  if (period === 'all' || period === 'custom' || !isStalePreset(period, from, to)) {
    return;
  }
  const href = periodHref(navigation.pathname, new URLSearchParams(navigation.query), period, rangeForPreset(period));
  navigation.router.replace(href, { scroll: false });
}

/**
 * @param props - The period the server rendered.
 * @param props.period - Preset id, `custom` or `all`.
 * @param props.from - The range's start as ISO, or null for all time.
 * @param props.to - The range's end as ISO, or null for all time.
 */
export function EvalPeriodPicker(props: { period: EvalPeriodId; from: string | null; to: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customOpen, setCustomOpen] = useState(false);
  const query = searchParams.toString();
  const navigation: Navigation = { router, pathname, query };

  // The effect callback is React's own construct and has no module-level form;
  // it only hands its values to `replaceStalePreset`.
  useEffect(() => replaceStalePreset({ router, pathname, query }, props.period, props.from, props.to), [router, pathname, query, props.period, props.from, props.to]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="eval-period">Period</label>
      <select
        id="eval-period"
        value={props.period}
        onChange={event => choosePeriodOption(event.target.value, setCustomOpen, navigation)}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium"
      >
        {EVAL_PERIOD_PRESETS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        <option value={CUSTOM_OPTION}>Custom range…</option>
      </select>
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50" aria-label="Pick a custom date range">
            <CalendarRange className="size-3.5" aria-hidden />
            {/* Worded in the viewer's timezone, which the server rendering it does not share. */}
            <span data-testid="eval-period-label" suppressHydrationWarning>{periodLabel(props.period, props.from, props.to)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3">
          <CustomRangeForm
            initial={initialCustomRange(props.from, props.to)}
            maxDays={MAX_RUN_RANGE_DAYS}
            onApply={range => applyCustomPeriod(range, setCustomOpen, navigation)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
