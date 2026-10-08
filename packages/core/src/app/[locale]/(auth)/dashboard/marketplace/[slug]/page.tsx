import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/marketplace/<slug> → /dashboard/hire/<slug> (308): an agent's
 * hiring profile moved with Hire an agent. The hire action's receipt and
 * links people already sent still land on the profile.
 * @param props
 * @param props.params - The catalog slug.
 */
export default async function MarketplaceProfileRedirect(props: { params: Promise<{ slug: string }> }): Promise<never> {
  const { slug } = await props.params;
  permanentRedirect(`/dashboard/hire/${encodeURIComponent(slug)}`);
}
