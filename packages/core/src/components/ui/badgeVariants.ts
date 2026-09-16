import { cva } from 'class-variance-authority';

/**
 * Badges after the airy pass (B-034b §2): no solid fills. The default is a
 * muted pill in sentence case; `accent` is amber at 12% for the one thing on
 * a page that earns colour; `outline` is a hairline. `secondary` and
 * `destructive` keep their names so call sites compile, restyled to match.
 */
export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-foreground/10 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default:
          'bg-foreground/[0.06] text-foreground/80 [a&]:hover:bg-foreground/10',
        secondary:
          'bg-surface-soft text-muted-foreground [a&]:hover:bg-surface-hover',
        accent:
          'bg-brand-amber/12 text-brand-amber-deep [a&]:hover:bg-brand-amber/20',
        destructive:
          'bg-brand-fail-bg text-brand-fail [a&]:hover:bg-brand-fail-bg/80',
        outline:
          'border-border text-foreground/80 [a&]:hover:bg-surface-hover',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);
