'use client';

import { cn } from '@/utils/Helpers';

/**
 * The one on/off switch: notification channels, automations. A button with
 * `role="switch"`, so a screen reader says what it is and whether it is on;
 * the label names what it switches, because the switch itself has no words.
 * @param props
 * @param props.on - Whether it is on.
 * @param props.label - What it switches, for assistive technology.
 * @param props.disabled - It cannot be switched here.
 * @param props.onChange - Called with the new state.
 */
export function Switch(props: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.on)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        props.on ? 'bg-foreground' : 'bg-foreground/15',
      )}
    >
      <span className={cn('inline-block size-4 rounded-full bg-background shadow transition-transform', props.on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}
