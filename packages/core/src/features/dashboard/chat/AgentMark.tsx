import { VOCION_PRIMARY_MARK } from '@/templates/VocionLogo';
import { cn } from '@/utils/Helpers';

const BRAND_MARK = process.env.NEXT_PUBLIC_BRAND_MARK || VOCION_PRIMARY_MARK;

/**
 * The speaker's mark on a transcript turn and in the rail's title: the
 * workspace brand glyph, small and quiet. It replaced the uppercase name on
 * every agent turn and the amber initial in the rail header (Chris,
 * 2026-09-18: "I probably don't need to see [R] Revenue Team and the
 * [revenue team] inline for every chat"). ONE identity still (§9.10): the
 * name is said once, in the surface's header; the turns carry the mark and
 * the name for a screen reader.
 * @param props
 * @param props.name - Who is speaking; read by assistive tech and on hover.
 * @param props.className - Size override; defaults to 16px.
 * @param props.decorative - True when the name is already text beside the mark (a header): nothing for a screen reader to repeat.
 */
export function AgentMark({ name, className, decorative = false }: { name: string; className?: string; decorative?: boolean }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)} title={decorative ? undefined : name} aria-hidden={decorative || undefined} data-agent-mark>
      {/* eslint-disable-next-line next/no-img-element */}
      <img src={BRAND_MARK} alt="" aria-hidden className="size-4 select-none" draggable={false} />
      {!decorative && <span className="sr-only">{name}</span>}
    </span>
  );
}
