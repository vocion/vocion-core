import { ImageResponse } from 'next/og';
import { faviconColor } from '@/libs/branding/favicon';
import { envLabel } from '@/libs/envLabel';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * In a non-production environment it becomes the LABEL on amber instead of
 * the mark. A preview tab and a production tab are otherwise identical, which
 * is how a bug gets filed against the wrong one — and the favicon is the only
 * part of a tab that survives being narrowed to nothing.
 *
 * Dynamic favicon — both rails of the official Vocion mark on Vocion Ink.
 * A tight, centered viewBox keeps the independent rails legible at tab sizes
 * instead of reducing the identity to a generic white checkmark. Served as
 * /icon by Next; takes precedence over public/favicon.ico in browsers that
 * request App Router icons.
 */
export default function Icon() {
  const color = faviconColor();
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
        {/* Official rail geometry, optically centered with enough separation at 16px. */}
        <svg width="28" height="24" viewBox="8 0 144 124" fill="none">
          <defs>
            <linearGradient id="leftRail" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7C3CFF" />
              <stop offset="52%" stopColor="#4D63FF" />
              <stop offset="100%" stopColor="#168BFF" />
            </linearGradient>
            <linearGradient id="rightRail" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#168BFF" />
              <stop offset="58%" stopColor="#16D6D2" />
              <stop offset="100%" stopColor="#55F58A" />
            </linearGradient>
          </defs>
          <path d="M24 22 L74 106 L136 16" stroke={color ?? 'url(#leftRail)'} strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M56 24 L77 60 L98 30" stroke={color ?? 'url(#rightRail)'} strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
