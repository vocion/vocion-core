import type { AdoptionStatus } from '@/services/adoption/AdoptionService';
import { TONE } from '@/components/ui/status-pill';
import { cn } from '@/utils/Helpers';

/**
 * Status pill for adoption classification. Separate from the run
 * StatusPill — that one's `Status` union is about run lifecycles;
 * these four are about people. It draws in the shared `TONE` sets instead of
 * its own copies of the strings (design sweep, 2026-10-23).
 */
const SPEC: Record<AdoptionStatus, { label: string; tone: keyof typeof TONE }> = {
  power: { label: 'Power user', tone: 'teal' },
  active: { label: 'Active', tone: 'pass' },
  dormant: { label: 'Dormant', tone: 'amber' },
  never: { label: 'Never adopted', tone: 'neutral' },
};

export function AdoptionStatusPill({ status, className }: { status: AdoptionStatus; className?: string }) {
  const spec = SPEC[status];
  const tone = TONE[spec.tone];
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        tone.bg,
        tone.border,
        tone.fg,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden />
      {spec.label}
    </span>
  );
}
