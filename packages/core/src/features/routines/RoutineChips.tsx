import type { ReactNode } from 'react';
import type { RoutineTone } from '@/libs/routines/display';
import type { Moment, RoutineTrust } from '@/libs/routines/types';
import { Play } from 'lucide-react';
import { TONE } from '@/components/ui/status-pill';
import { TRUST_TONE } from '@/libs/routines/display';
import { clock, momentUrl, TRUST_LABEL } from '@/libs/routines/types';
import { cn } from '@/utils/Helpers';

/**
 * The small marks every routine surface draws: a chip in one of the design
 * system's tones (`status-pill` `TONE`), the trust chip, and a moment on the
 * recording as a link that opens Slate at that second.
 */

/**
 * A pill in a status tone.
 * @param props
 * @param props.tone - Its tone.
 * @param props.children - Its words.
 * @param props.dot - Lead with a dot.
 * @param props.pulse - The dot breathes: it is moving.
 * @param props.className
 */
export function ToneChip(props: { tone: RoutineTone; children: ReactNode; dot?: boolean; pulse?: boolean; className?: string }) {
  const t = TONE[props.tone];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap', t.bg, t.border, t.fg, props.className)}>
      {props.dot && <span className={cn('size-1.5 rounded-full bg-current', props.pulse && 'motion-safe:animate-pulse')} aria-hidden />}
      {props.children}
    </span>
  );
}

/**
 * Where the routine is on the trust ladder.
 * @param props
 * @param props.trust - Its rung.
 * @param props.className
 */
export function TrustChip(props: { trust: RoutineTrust; className?: string }) {
  return <ToneChip tone={TRUST_TONE[props.trust]} className={props.className}><span data-routine-trust={props.trust}>{TRUST_LABEL[props.trust]}</span></ToneChip>;
}

/**
 * A moment on the recording: "▶ 1:23", opening Slate at that second.
 * @param props
 * @param props.url - The recording's share link.
 * @param props.at - Seconds, or null when it was not shown.
 * @param props.className
 */
export function MomentLink(props: { url: string | null | undefined; at: Moment; className?: string }) {
  if (props.at === null || !props.url) {
    return null;
  }
  return (
    <a
      href={momentUrl(props.url, props.at)}
      target="_blank"
      rel="noopener noreferrer"
      title="Watch this moment on the recording"
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground tabular-nums transition hover:bg-surface-hover hover:text-foreground', props.className)}
      data-moment={props.at}
    >
      <Play className="size-2.5 fill-current" aria-hidden />
      {clock(props.at)}
    </a>
  );
}
