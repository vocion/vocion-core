import type { AdoptionStatus } from '@/services/adoption/AdoptionService';
import { cn } from '@/utils/Helpers';

/**
 * Status pill for adoption classification. Separate from the run
 * StatusPill — that one's `Status` union is about run lifecycles;
 * these four are about people.
 */
const SPEC: Record<AdoptionStatus, { label: string; classes: string }> = {
  power: {
    label: 'Power user',
    classes: 'bg-[var(--brand-teal-tint)] border-[var(--brand-teal)]/30 text-[var(--brand-teal-deep)]',
  },
  active: {
    label: 'Active',
    classes: 'bg-[var(--brand-pass-bg)] border-[var(--brand-pass)]/30 text-[var(--brand-pass)]',
  },
  dormant: {
    label: 'Dormant',
    classes: 'bg-[var(--brand-borderline-bg)] border-[var(--brand-borderline)]/30 text-[var(--brand-borderline)]',
  },
  never: {
    label: 'Never adopted',
    classes: 'bg-muted/50 border-border text-muted-foreground',
  },
};

export function AdoptionStatusPill({ status, className }: { status: AdoptionStatus; className?: string }) {
  const spec = SPEC[status];
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        spec.classes,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden />
      {spec.label}
    </span>
  );
}
