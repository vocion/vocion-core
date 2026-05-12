import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { GitBranch, ShieldCheck, Zap } from 'lucide-react';
import { cn } from '@/utils/Helpers';

/**
 * Stepper — vertical step list for workflow definitions and runs.
 * Pure CSS (no graph library). Linear by design — branching is a
 * future-state concern.
 *
 * Each step has:
 *   - a type-coded icon (skill=Zap/amber, approve=ShieldCheck/teal,
 *     action=GitBranch/neutral)
 *   - a name + optional secondary line (skill slug, action name)
 *   - an optional aggregate slot ("ran N times · M paused") shown to
 *     the right when run history exists
 *   - an optional inline output preview underneath
 *
 * HITL gates (`approve` steps) get a soft amber-tinted background so
 * the eye fixates immediately.
 */

export type StepperStepType = 'skill' | 'approve' | 'action';

export type StepperStep = {
  /** Stable key (step name in most cases). */
  key: string;
  type: StepperStepType;
  title: string;
  /** Secondary line below title — slug, action name, or HITL prompt. */
  subtitle?: ReactNode;
  /** Aggregate text rendered right-aligned. e.g. "Ran 12 · 2 paused". */
  aggregate?: ReactNode;
  /** Optional one-line output preview. */
  outputPreview?: string;
};

type Props = {
  steps: StepperStep[];
  className?: string;
};

const TYPE_SPEC: Record<StepperStepType, {
  icon: LucideIcon;
  iconBg: string;
  iconFg: string;
  rowBg: string;
  badgeLabel: string;
  badgeClass: string;
}> = {
  skill: {
    icon: Zap,
    iconBg: 'bg-[var(--brand-amber-tint)]',
    iconFg: 'text-[var(--brand-amber-deep)]',
    rowBg: 'bg-background',
    badgeLabel: 'Operation',
    badgeClass: 'border-[var(--brand-amber)]/30 bg-[var(--brand-amber-tint)] text-[var(--brand-amber-deep)]',
  },
  approve: {
    icon: ShieldCheck,
    iconBg: 'bg-[var(--brand-teal-tint)]',
    iconFg: 'text-[var(--brand-teal-deep)]',
    // HITL row gets soft amber tint so the eye fixates.
    rowBg: 'bg-[var(--brand-amber-tint)]/40',
    badgeLabel: 'Approval gate',
    badgeClass: 'border-[var(--brand-teal)]/30 bg-[var(--brand-teal-tint)] text-[var(--brand-teal-deep)]',
  },
  action: {
    icon: GitBranch,
    iconBg: 'bg-muted',
    iconFg: 'text-muted-foreground',
    rowBg: 'bg-background',
    badgeLabel: 'Action',
    badgeClass: 'border-border bg-muted text-muted-foreground',
  },
};

export function Stepper({ steps, className }: Props) {
  return (
    <ol className={cn('relative space-y-2', className)}>
      {steps.map((step, i) => {
        const spec = TYPE_SPEC[step.type];
        const Icon = spec.icon;
        const isLast = i === steps.length - 1;
        return (
          <li key={step.key} className="relative flex gap-3">
            {/* Connecting line between step icons */}
            {!isLast && (
              <span
                aria-hidden
                className="absolute top-9 left-[15px] -ml-px w-px bg-border"
                style={{ height: 'calc(100% - 1rem)' }}
              />
            )}
            <div className={cn('relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full', spec.iconBg, spec.iconFg)}>
              <Icon className="size-4" aria-hidden />
            </div>
            <div className={cn('flex-1 rounded-md border border-border px-3 py-2.5', spec.rowBg)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-semibold">{step.title}</span>
                <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium', spec.badgeClass)}>
                  {spec.badgeLabel}
                </span>
                {step.aggregate && (
                  <span className="ml-auto text-[11px] text-muted-foreground">{step.aggregate}</span>
                )}
              </div>
              {step.subtitle && (
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{step.subtitle}</div>
              )}
              {step.outputPreview && (
                <div className="mt-1 line-clamp-2 font-mono text-[11px] text-foreground/70">{step.outputPreview}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
