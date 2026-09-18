import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * Apple touch icon — the Vocion governed-path V mark with the brand gradient
 * rails on Vocion Ink, sized for the iOS home screen. Same geometry as
 * `public/brand/vocion-primary-mark.svg` and vocion.ai's `app/apple-icon.tsx`.
 */
export default function AppleIcon() {
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
          borderRadius: 40,
        }}
      >
        <svg width="132" height="95" viewBox="0 0 180 130" fill="none">
          <defs>
            <linearGradient id="l" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7C3CFF" />
              <stop offset="52%" stopColor="#4D63FF" />
              <stop offset="100%" stopColor="#168BFF" />
            </linearGradient>
            <linearGradient id="r" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#168BFF" />
              <stop offset="58%" stopColor="#16D6D2" />
              <stop offset="100%" stopColor="#55F58A" />
            </linearGradient>
          </defs>
          <path d="M24 22 L74 106 L136 16" stroke="url(#l)" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M56 24 L77 60 L98 30" stroke="url(#r)" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
