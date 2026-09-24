'use client';

import type { FormEvent } from 'react';
import type { DateRange } from './periods';
import { useState } from 'react';
import { customRange, toDateInput } from './periods';

/**
 * The custom-range form behind a period picker's "Custom range…": two date
 * inputs, both days included, validated before anything is fetched.
 *
 * Shared by the scorecard and the eval dataset page so a custom range is
 * picked, checked and worded the same way on both.
 */

/**
 * Validate the custom range and either apply it or show why not. Stops the
 * form's own submit — it has nowhere to go.
 * @param event - The form's submit event.
 * @param fromValue - The From input's value.
 * @param toValue - The To input's value.
 * @param maxDays - The longest range the page accepts.
 * @param onApply - Receives a valid range.
 * @param onError - Receives the message for an invalid one, or null once valid.
 */
function submitCustomRange(event: FormEvent, fromValue: string, toValue: string, maxDays: number, onApply: (range: DateRange) => void, onError: (message: string | null) => void): void {
  event.preventDefault();
  const result = customRange(fromValue, toValue, maxDays);
  if (result.ok) {
    onError(null);
    onApply(result.range);
  } else {
    onError(result.message);
  }
}

/**
 * The custom-range form inside the popover: two date inputs, both days included.
 * @param props - The range to start from, and what to do with a valid one.
 * @param props.initial - The range currently on screen, to prefill the inputs.
 * @param props.maxDays - The longest range the page accepts; a longer one is refused with a message.
 * @param props.onApply - Receives the new range when it is valid.
 */
export function CustomRangeForm(props: { initial: DateRange; maxDays: number; onApply: (range: DateRange) => void }) {
  const lastDay = new Date(props.initial.to.getFullYear(), props.initial.to.getMonth(), props.initial.to.getDate() - 1);
  const [fromValue, setFromValue] = useState(() => toDateInput(props.initial.from));
  const [toValue, setToValue] = useState(() => toDateInput(lastDay));
  const [error, setError] = useState<string | null>(null);
  const today = toDateInput(new Date());

  return (
    <form
      className="space-y-3"
      onSubmit={event => submitCustomRange(event, fromValue, toValue, props.maxDays, props.onApply, setError)}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[11px] text-muted-foreground">
          <span>From</span>
          <input type="date" value={fromValue} max={today} onChange={event => setFromValue(event.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" />
        </label>
        <label className="space-y-1 text-[11px] text-muted-foreground">
          <span>To</span>
          <input type="date" value={toValue} max={today} onChange={event => setToValue(event.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" />
        </label>
      </div>
      {error && <p className="text-[11px] text-destructive" role="alert">{error}</p>}
      <button type="submit" className="w-full rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background">Apply</button>
    </form>
  );
}
