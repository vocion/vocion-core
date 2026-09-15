/**
 * Brand mark + wordmark + optional tagline.
 *
 * Defaults to the Vocion identity from vocion.ai — the "governed path" V mark
 * (two independent rails: a violet→indigo→blue governance rail and a
 * blue→cyan→green execution rail) shipped as static SVGs in `public/brand/`:
 *   - /brand/vocion-primary-mark.svg — gradient mark. The default glyph; reads
 *     on light and dark surfaces alike.
 *   - /brand/vocion-mono-mark.svg    — single-colour ink (#0B1020) mark for
 *     monochrome / print contexts. Light surfaces only.
 *   - /brand/vocion-logo-lockup.svg  — mark + VOCION wordmark + descriptor as
 *     one image. Ink text, so light surfaces only; opt in via
 *     NEXT_PUBLIC_BRAND_LOCKUP (and supply a dark variant if you need one).
 *
 * White-label slot, all build-time env (NEXT_PUBLIC_* is inlined at build).
 * Anything set here wins over the Vocion defaults — existing deployments keep
 * rendering exactly what they passed:
 *   - NEXT_PUBLIC_BRAND_NAME    — the wordmark text. Default `Vocion`.
 *   - NEXT_PUBLIC_BRAND_TAGLINE — optional subhead under the wordmark
 *     (e.g. "agents by Vocion"). Omitted when unset.
 *   - NEXT_PUBLIC_BRAND_MARK    — glyph image src (path or data: URI). Replaces
 *     the Vocion mark; deployments pass their own logo here so the OSS build
 *     carries no third-party art.
 *   - NEXT_PUBLIC_BRAND_LOCKUP / NEXT_PUBLIC_BRAND_LOCKUP_DARK — see below.
 * @param props
 * @param props.isTextHidden
 * @param props.size
 */
/** The Vocion primary mark shipped in `public/brand/` — the default glyph. */
export const VOCION_PRIMARY_MARK = '/brand/vocion-primary-mark.svg';

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'Vocion';
const BRAND_TAGLINE = process.env.NEXT_PUBLIC_BRAND_TAGLINE || '';
const BRAND_MARK = process.env.NEXT_PUBLIC_BRAND_MARK || VOCION_PRIMARY_MARK;
// Full lockup (mark + wordmark as ONE image). When set it replaces both the
// glyph and the wordmark text — only the tagline renders beneath it. Use for
// deployments whose brand asset already includes the company name.
const BRAND_LOCKUP = process.env.NEXT_PUBLIC_BRAND_LOCKUP || '';
// Dark-mode variant of the lockup (e.g. a white wordmark). Only used when
// BRAND_LOCKUP is also set; the pair swaps via the `.dark` class variant.
const BRAND_LOCKUP_DARK = process.env.NEXT_PUBLIC_BRAND_LOCKUP_DARK || '';

export const VocionLogo = (props: { isTextHidden?: boolean; size?: 'sm' | 'md' | 'lg' }) => {
  if (BRAND_LOCKUP) {
    const lockupH
      = props.size === 'sm'
        ? 'h-6'
        : props.size === 'lg'
          ? 'h-10'
          : 'h-8';
    return (
      <div className="flex min-w-0 flex-col items-start gap-1">
        {/* eslint-disable-next-line next/no-img-element */}
        <img src={BRAND_LOCKUP} alt={BRAND_NAME} className={`w-auto ${lockupH} ${BRAND_LOCKUP_DARK ? 'dark:hidden' : ''}`} />
        {BRAND_LOCKUP_DARK && (
          // eslint-disable-next-line next/no-img-element
          <img src={BRAND_LOCKUP_DARK} alt={BRAND_NAME} className={`hidden w-auto dark:block ${lockupH}`} />
        )}
        {!props.isTextHidden && BRAND_TAGLINE && (
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
            {BRAND_TAGLINE}
          </span>
        )}
      </div>
    );
  }

  // Height-driven so non-square marks (the Vocion V is 180×130) keep their
  // aspect ratio; a square white-label glyph renders at the same box as before.
  const iconSize
    = props.size === 'sm'
      ? 'h-6'
      : props.size === 'lg'
        ? 'h-9'
        : 'h-7';
  const textSize
    = props.size === 'sm'
      ? 'text-base'
      : props.size === 'lg'
        ? 'text-2xl'
        : 'text-lg';

  return (
    <div className="inline-flex items-center gap-2">
      {/* eslint-disable-next-line next/no-img-element */}
      <img src={BRAND_MARK} alt="" className={`w-auto shrink-0 ${iconSize}`} aria-hidden="true" />
      {!props.isTextHidden && (
        <span className="flex min-w-0 flex-col leading-none">
          <span className={`font-semibold tracking-tight ${textSize}`}>{BRAND_NAME}</span>
          {BRAND_TAGLINE && (
            <span className="mt-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
              {BRAND_TAGLINE}
            </span>
          )}
        </span>
      )}
    </div>
  );
};
