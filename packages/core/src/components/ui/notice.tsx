import type { ReactNode } from 'react';
import { AlertTriangle, CircleAlert, CircleCheck, Info } from 'lucide-react';
import { cn } from '@/utils/Helpers';

/**
 * Notice: the one inline message a page or a card shows about itself (design
 * foundations, 2026-10-23). It replaced about 25 hand-made red and amber boxes
 * in four radii. A soft fill in its tone, an icon, the words, and at most one
 * action on the right; no border, so it never reads as a box inside a box.
 *
 * - `fail`: something broke and the person can act on it ("Couldn't save").
 * - `warn`: a risk or a limit ("Over budget at the current pace").
 * - `waiting`: something waits on a person; amber's one meaning outside the brand.
 * - `info`: plain context, in the neutral soft surface.
 * - `pass`: a confirmation that should stay on screen (a toast is usually better).
 *
 * `edge` is the full-width form for the top of a page or app (the budget and
 * off-switch banners): no radius, a hairline below.
 */
export type NoticeTone = 'fail' | 'warn' | 'waiting' | 'info' | 'pass';

const TONE: Record<NoticeTone, { box: string; icon: string; Icon: typeof Info }> = {
  fail: { box: 'bg-fail-soft', icon: 'text-fail', Icon: CircleAlert },
  warn: { box: 'bg-warn-soft', icon: 'text-warn', Icon: AlertTriangle },
  waiting: { box: 'bg-waiting-soft', icon: 'text-waiting', Icon: Info },
  info: { box: 'bg-surface-soft', icon: 'text-muted-foreground', Icon: Info },
  pass: { box: 'bg-pass-soft', icon: 'text-pass', Icon: CircleCheck },
};

export function Notice({ tone = 'info', title, children, action, edge = false, icon = true, className, role, ...rest }: {
  'tone'?: NoticeTone;
  /** A bold first line, when the message needs a headline. */
  'title'?: ReactNode;
  'children'?: ReactNode;
  /** One control on the right: Retry, Review, Dismiss. */
  'action'?: ReactNode;
  /** Full width at the top of a page or the app, with a hairline below. */
  'edge'?: boolean;
  'icon'?: boolean;
  'className'?: string;
  /** Defaults to `alert` for fail, `status` otherwise. */
  'role'?: 'alert' | 'status';
  'data-testid'?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      role={role ?? (tone === 'fail' ? 'alert' : 'status')}
      data-slot="notice"
      data-tone={tone}
      className={cn(
        'flex items-start gap-2.5 text-[13px] leading-snug text-foreground',
        t.box,
        edge ? 'border-b border-border px-4 py-2.5' : 'rounded-lg px-3 py-2.5',
        className,
      )}
      {...rest}
    >
      {icon && <t.Icon className={cn('mt-px size-4 shrink-0', t.icon)} strokeWidth={1.75} aria-hidden />}
      <div className="min-w-0 flex-1 break-words">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={title ? 'mt-0.5 text-muted-foreground' : undefined}>{children}</div>}
      </div>
      {action && <div className="-my-0.5 shrink-0">{action}</div>}
    </div>
  );
}
