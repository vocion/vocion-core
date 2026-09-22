import type { MetadataRoute } from 'next';
import { envLabel } from '@/libs/envLabel';
import { AppConfig } from '@/utils/AppConfig';

/**
 * INSTALL TO THE HOME SCREEN.
 *
 * The dashboard is reviewed on a phone more than anywhere else, and in a
 * browser tab it loses a third of the screen to chrome, forgets it on every
 * cold start, and — the reason this exists — cannot receive a push
 * notification at all. On iOS, web push requires the site to have been added
 * to the Home Screen first; there is no other route to it. So the manifest is
 * not a nicety, it is the prerequisite for the factory ever being able to tell
 * somebody that their decision is holding work up.
 *
 * `standalone` so it opens without browser chrome; `id` pinned so a reinstall
 * replaces the same app rather than adding a second one. The env label rides
 * the NAME as well as the icon, because a preview app and a production app
 * sitting side by side on a home screen are otherwise indistinguishable — the
 * same reason the favicon and the page title carry it.
 */
export default function manifest(): MetadataRoute.Manifest {
  const label = envLabel();
  const name = label === null ? AppConfig.name : `${AppConfig.name} ${label}`;
  return {
    id: '/dashboard',
    name,
    short_name: name,
    description: 'The workspace, its agents and the work they are doing.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    // Amber on a preview, ink in production — the status bar takes this, so
    // an installed preview is tinted differently from the real thing.
    theme_color: label === null ? '#0b0b0f' : '#f59e0b',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
