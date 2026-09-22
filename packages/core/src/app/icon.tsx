import { ImageResponse } from 'next/og';
import { envLabel } from '@/libs/envLabel';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * In a non-production environment it becomes the LABEL on amber instead of
 * the mark. A preview tab and a production tab are otherwise identical, which
 * is how a bug gets filed against the wrong one — and the favicon is the only
 * part of a tab that survives being narrowed to nothing.
 *
 * Dynamic favicon — the Vocion governed-path V mark, mono-white on Vocion Ink,
 * matching vocion.ai's `app/icon.tsx`. One colour at 32px for crispness; the
 * gradient rails belong to larger sizes (see `apple-icon.tsx`). Served as
 * /icon by Next; takes precedence over public/favicon.ico in browsers that
 * request App Router icons.
 */
export default function Icon() {
  const label = envLabel();
  if (label !== null) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#B45309',
            color: '#FFFFFF',
            borderRadius: 7,
            fontSize: label.length > 3 ? 13 : 16,
            fontWeight: 700,
            letterSpacing: -0.5,
          }}
        >
          {label}
        </div>
      ),
      { ...size },
    );
  }
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0B1020',
          borderRadius: 7,
        }}
      >
        {/* Simplified glyph for the smallest size: the outer rail only. */}
        <svg width="26" height="19" viewBox="0 0 180 130" fill="none">
          <path d="M24 22 L74 106 L136 16" stroke="#F2F5FB" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
