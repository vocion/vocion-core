/**
 * Brand mark + wordmark + optional tagline.
 *
 * White-label slot, all build-time env (NEXT_PUBLIC_* is inlined at build):
 *   - NEXT_PUBLIC_BRAND_NAME    — the wordmark text. Default `Vocion`.
 *   - NEXT_PUBLIC_BRAND_TAGLINE — optional subhead under the wordmark
 *     (e.g. "agents by Vocion"). Omitted when unset.
 *   - NEXT_PUBLIC_BRAND_MARK    — optional glyph image src (path or data: URI).
 *     When set, it replaces the built-in Vocion bars mark. Deployments pass
 *     their own logo here so the OSS build carries no third-party art.
 *
 * The default mark is three rising bars — growth, signal, momentum — filled
 * with `currentColor` so it inherits the surrounding text color.
 * @param props
 * @param props.isTextHidden
 * @param props.size
 */
const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'Vocion';
const BRAND_TAGLINE = process.env.NEXT_PUBLIC_BRAND_TAGLINE || '';
const BRAND_MARK = process.env.NEXT_PUBLIC_BRAND_MARK || '';
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

  const iconSize
    = props.size === 'sm'
      ? 'size-6'
      : props.size === 'lg'
        ? 'size-9'
        : 'size-7';
  const textSize
    = props.size === 'sm'
      ? 'text-base'
      : props.size === 'lg'
        ? 'text-2xl'
        : 'text-lg';

  return (
    <div className="inline-flex items-center gap-2">
      {BRAND_MARK
        ? (
            // eslint-disable-next-line next/no-img-element
            <img src={BRAND_MARK} alt="" className={`shrink-0 ${iconSize}`} aria-hidden="true" />
          )
        : (
            <svg
              className={`shrink-0 ${iconSize}`}
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              {/* Three rising bars — growth, signal, momentum. */}
              <rect x="3" y="14" width="4" height="7" rx="1" />
              <rect x="10" y="9" width="4" height="12" rx="1" />
              <rect x="17" y="4" width="4" height="17" rx="1" />
            </svg>
          )}
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
