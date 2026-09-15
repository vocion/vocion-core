import { cva } from 'class-variance-authority';

/**
 * Buttons after the airy pass (B-034b §2): ghost by default in spirit — the
 * one primary action on a page is ink (`--action`), secondaries are hairline
 * outlines, everything else is text. No shadows, no translate; a 150ms
 * background fade is the only motion. Amber stays for brand, focus and links.
 */
export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-foreground/10 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg:not([class*=\'size-\'])]:size-4',
  {
    variants: {
      variant: {
        default:
          'bg-action text-action-foreground hover:bg-action/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        outline:
          'border border-border bg-background hover:bg-surface-hover dark:bg-input/20 dark:hover:bg-input/40',
        secondary:
          'bg-surface-soft text-foreground hover:bg-surface-hover',
        ghost:
          'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3.5 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 rounded-lg px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-lg px-5 text-sm has-[>svg]:px-4',
        icon: 'size-9',
        /** Chip-shaped action — header pills, inline row actions. */
        pill: 'h-8 rounded-full px-3',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);
