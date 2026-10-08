import type { ComponentProps } from 'react';
import { cn } from '@/utils/Helpers';
import { TONE } from './status-pill';

/**
 * StatusBadge — whether a thing in a catalog can be had yet: `available`,
 * `beta` or `coming`. It answers a different question from `StatusPill` (the
 * state of a record you have), so it is its own word, but it draws in the
 * same token sets so the two never drift: available is the pass green, beta
 * the borderline amber, coming the neutral outline.
 *
 * A front-door element (`docs/design/patterns.md` § Front doors): it sits on
 * a `CatalogCard` or a catalog row, never on a work surface.
 */

export type Availability = 'available' | 'beta' | 'coming';

const SPEC: Record<Availability, { tone: keyof typeof TONE; label: string }> = {
  available: { tone: 'pass', label: 'Available' },
  beta: { tone: 'amber', label: 'Beta' },
  coming: { tone: 'neutral', label: 'Coming' },
};

type Props = ComponentProps<'span'> & {
  status: Availability;
  /** Override the word (e.g. "Today", "On the roadmap"); the colour stays the status's. */
  label?: string;
};

export function StatusBadge({ status, label, className, ...rest }: Props) {
  const spec = SPEC[status];
  const tone = TONE[spec.tone];
  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap',
        status === 'coming' ? 'border-border bg-transparent text-muted-foreground' : [tone.bg, 'border-transparent', tone.fg],
        className,
      )}
      {...rest}
    >
      {label ?? spec.label}
    </span>
  );
}
