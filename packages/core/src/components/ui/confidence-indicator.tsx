import type { ComponentProps } from 'react';
import type { ConfidenceLevel } from '@/types/Status';
import { cn } from '@/utils/Helpers';

/**
 * ConfidenceIndicator — small inline element conveying the agent's
 * self-assessment of an output. Three levels:
 *
 *   - confident   — green dot, "Confident"
 *   - uncertain   — amber dot, "Uncertain"
 *   - speculative — neutral, "Speculative"
 *
 * Uses the same design tokens as <StatusPill> so the visual language
 * stays consistent. Renders nothing for null/undefined input — at
 * runtime, most paths don't yet expose a confidence signal and we
 * don't want a "—" placeholder cluttering screenshots.
 */

type Spec = { bg: string; border: string; fg: string; label: string };

const SPEC: Record<ConfidenceLevel, Spec> = {
  confident: {
    bg: 'bg-[var(--brand-pass-bg)]',
    border: 'border-[var(--brand-pass)]/30',
    fg: 'text-[var(--brand-pass)]',
    label: 'Confident',
  },
  uncertain: {
    bg: 'bg-[var(--brand-borderline-bg)]',
    border: 'border-[var(--brand-borderline)]/30',
    fg: 'text-[var(--brand-borderline)]',
    label: 'Uncertain',
  },
  speculative: {
    bg: 'bg-muted/50',
    border: 'border-border',
    fg: 'text-muted-foreground',
    label: 'Speculative',
  },
};

type Props = ComponentProps<'span'> & {
  level: ConfidenceLevel | null | undefined;
  size?: 'sm' | 'md';
};

export function ConfidenceIndicator({ level, size = 'sm', className, ...rest }: Props) {
  if (!level) {
    return null;
  }
  const spec = SPEC[level];
  const padding = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span
      data-slot="confidence-indicator"
      data-level={level}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap',
        padding,
        spec.bg,
        spec.border,
        spec.fg,
        className,
      )}
      title={`Agent self-assessed confidence: ${spec.label.toLowerCase()}`}
      {...rest}
    >
      <span className="size-1 rounded-full bg-current opacity-80" aria-hidden />
      {spec.label}
    </span>
  );
}
