import { cn } from '@/utils/Helpers';

/**
 * SparkOrb — the mark of an agent at work: the spark (`--spark`, styles/global.css)
 * as a small sphere with a highlight. Working, it turns and breathes a glow;
 * idle, it holds still. It is the one place the spark takes a shape, so the
 * colour keeps one meaning across the app: an agent is here, doing something.
 *
 * Decorative by default — the words beside it (the live line, the greeting)
 * already say what is happening.
 */

const SIZE = {
  xs: 'size-4',
  sm: 'size-5',
  md: 'size-6',
  lg: 'size-8',
  xl: 'size-12',
} as const;

export type SparkOrbSize = keyof typeof SIZE;

export function SparkOrb({ size = 'xs', working = true, label, className }: {
  size?: SparkOrbSize;
  /** Turning and glowing while an agent works; still at rest. */
  working?: boolean;
  /** An accessible name, when nothing beside the orb says it. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      data-slot="spark-orb"
      data-state={working ? 'working' : 'idle'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('spark-orb', SIZE[size], className)}
    />
  );
}
