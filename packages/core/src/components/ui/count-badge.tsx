import { cn } from '@/utils/Helpers';

/**
 * CountBadge: the one count beside a nav row, a workspace or the bell
 * (design foundations, 2026-10-23). It replaced three heights and two fills.
 * `waiting` (the default) means something waits on the person, in amber, the
 * colour's one meaning outside the brand; `quiet` is a plain count in muted
 * ink. Nothing renders for zero.
 * @param root0
 * @param root0.count
 * @param root0.tone
 * @param root0.max
 * @param root0.className
 * @param root0.label
 * @param root0.title
 */
export function CountBadge({ count, tone = 'waiting', max = 99, className, label, ...rest }: {
  'count': number;
  'tone'?: 'waiting' | 'quiet';
  /** Above this, the badge reads "99+". */
  'max'?: number;
  'className'?: string;
  /** An accessible label when the count stands alone ("3 waiting on you"). */
  'label'?: string;
  /** A hover tooltip, when the count has a longer name. */
  'title'?: string;
  'data-testid'?: string;
}) {
  if (count <= 0) {
    return null;
  }
  return (
    <span
      data-slot="count-badge"
      aria-label={label}
      className={cn(
        'inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10.5px] leading-none font-semibold tabular-nums',
        tone === 'waiting' ? 'bg-waiting-soft text-waiting' : 'bg-surface-soft text-muted-foreground',
        className,
      )}
      {...rest}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
