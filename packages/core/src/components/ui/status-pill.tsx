import type { ComponentProps } from 'react';
import type { Status } from '@/types/Status';
import { cn } from '@/utils/Helpers';

/**
 * StatusPill — the single source of truth for rendering a status
 * label across the dashboard. Uses design tokens only (no hardcoded
 * Tailwind colours). The `switch` over `status` is exhaustive at
 * compile time — adding a new `Status` value without a visual
 * treatment here is a TypeScript error.
 *
 * Visual treatment maps each status to one of four token sets:
 *
 *   - pass   (green)   — `completed`, `approved`, `active`, `configured`
 *   - amber  (warm)    — `pending`, `paused`, `auto`
 *   - fail   (red)     — `failed`, `rejected`, `cancelled`
 *   - neutral          — `running`, `inactive`, `unconfigured`
 */

type Tone = 'pass' | 'amber' | 'fail' | 'neutral' | 'teal';

type ToneSpec = {
  /** Pill background colour (CSS variable expr). */
  bg: string;
  /** Border colour. */
  border: string;
  /** Text + dot colour. */
  fg: string;
};

const TONE: Record<Tone, ToneSpec> = {
  pass: {
    bg: 'bg-[var(--brand-pass-bg)]',
    border: 'border-[var(--brand-pass)]/30',
    fg: 'text-[var(--brand-pass)]',
  },
  amber: {
    bg: 'bg-[var(--brand-borderline-bg)]',
    border: 'border-[var(--brand-borderline)]/30',
    fg: 'text-[var(--brand-borderline)]',
  },
  fail: {
    bg: 'bg-[var(--brand-fail-bg)]',
    border: 'border-[var(--brand-fail)]/30',
    fg: 'text-[var(--brand-fail)]',
  },
  neutral: {
    bg: 'bg-muted/50',
    border: 'border-border',
    fg: 'text-muted-foreground',
  },
  teal: {
    bg: 'bg-[var(--brand-teal-tint)]',
    border: 'border-[var(--brand-teal)]/30',
    fg: 'text-[var(--brand-teal-deep)]',
  },
};

function specFor(status: Status): { tone: Tone; label: string } {
  switch (status) {
    // Pass — green
    case 'completed': return { tone: 'pass', label: 'Completed' };
    case 'approved': return { tone: 'pass', label: 'Approved' };
    case 'active': return { tone: 'pass', label: 'Active' };
    case 'configured': return { tone: 'pass', label: 'Configured' };

    // Amber — pending / paused / auto
    case 'pending': return { tone: 'amber', label: 'Pending' };
    case 'paused': return { tone: 'amber', label: 'Paused' };
    case 'auto': return { tone: 'amber', label: 'Auto-approved' };

    // Fail — red
    case 'failed': return { tone: 'fail', label: 'Failed' };
    case 'rejected': return { tone: 'fail', label: 'Rejected' };
    case 'cancelled': return { tone: 'fail', label: 'Cancelled' };

    // Neutral
    case 'running': return { tone: 'neutral', label: 'Running' };
    case 'inactive': return { tone: 'neutral', label: 'Inactive' };
    case 'unconfigured': return { tone: 'neutral', label: 'Unconfigured' };
  }
}

type Props = ComponentProps<'span'> & {
  status: Status;
  /** Optional override label (e.g. "Auto · no review"); falls back to default. */
  label?: string;
  size?: 'sm' | 'md';
  /** Render a leading status dot. Default true. */
  dot?: boolean;
};

export function StatusPill({ status, label, size = 'md', dot = true, className, ...rest }: Props) {
  const spec = specFor(status);
  const tone = TONE[spec.tone];
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs';
  return (
    <span
      data-slot="status-pill"
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        padding,
        tone.bg,
        tone.border,
        tone.fg,
        className,
      )}
      {...rest}
    >
      {dot && <span className={cn('size-1.5 rounded-full', 'bg-current opacity-80')} aria-hidden />}
      {label ?? spec.label}
    </span>
  );
}
