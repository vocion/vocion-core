import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/marketplace → /dashboard/hire (308).
 *
 * Agents for hire left the marketplace for Workforce, as "Hire an agent", a
 * tab of Teams & agents beside the agents you already have (Chris,
 * 2026-10-08); apps and their features are /dashboard/apps. The old path is
 * in pinned nav entries and in links people already sent, so it redirects.
 */
export default function MarketplaceRedirect(): never {
  permanentRedirect('/dashboard/hire');
}
