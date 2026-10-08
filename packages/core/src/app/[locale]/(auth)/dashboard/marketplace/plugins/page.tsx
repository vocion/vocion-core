import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/marketplace/plugins → /dashboard/apps (308), and `?app=<id>`
 * (the door a More-apps card used to open) → that app's page. Apps and their
 * features replaced the plugin list (Chris, 2026-10-08); the old path is in
 * pinned nav entries and in links people already sent.
 * @param props
 * @param props.searchParams - `app`, when an old app door is followed.
 */
export default async function MarketplacePluginsRedirect(props: { searchParams: Promise<{ app?: string | string[] }> }): Promise<never> {
  const { app } = await props.searchParams;
  permanentRedirect(typeof app === 'string' && app ? `/dashboard/apps/${encodeURIComponent(app)}` : '/dashboard/apps');
}
