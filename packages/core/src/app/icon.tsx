import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * Dynamic favicon — the Vocion mark (three rising bars) rendered at
 * 32×32. Served as /icon by Next; takes precedence over public/favicon.ico
 * in browsers that request App Router icons.
 */
export default function Icon() {
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
          borderRadius: 6,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="14" width="4" height="7" rx="1" />
          <rect x="10" y="9" width="4" height="12" rx="1" />
          <rect x="17" y="4" width="4" height="17" rx="1" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
