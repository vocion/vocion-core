import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * Apple touch icon — Vocion mark on the brand-dark background, sized
 * for iOS home-screen + Safari pinned tab. Same three-bar logo as
 * `app/icon.tsx`, just bigger + with more padding.
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
          background: '#0a0a0a',
          color: '#f5f5f5',
          borderRadius: 38,
        }}
      >
        <svg width="120" height="120" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="14" width="4" height="7" rx="1" />
          <rect x="10" y="9" width="4" height="12" rx="1" />
          <rect x="17" y="4" width="4" height="17" rx="1" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
