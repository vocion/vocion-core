import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { OrgBrandProvider } from '@/features/branding/BrandContext';
import { OrgBrandStyle } from '@/features/branding/OrgBrandStyle';
import { AuthProviders } from '@/features/navigation/AuthProviders';
import { auth } from '@/libs/Auth';
import { brandTitle } from '@/libs/branding/orgBrand';
import { titlePrefix } from '@/libs/envLabel';
import { WORKSPACE_HEADER } from '@/libs/links';
import { brandViewForRequest } from '@/services/branding/OrgBrandService';

/**
 * The tab an Org's people see: "Northwind · Vocion", and the Org's mark as
 * the favicon when its brand has one. Unbranded, nothing changes.
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await brandViewForRequest().catch(() => null);
  if (!brand) {
    return {};
  }
  return {
    title: { default: `${titlePrefix()}${brandTitle(brand.name)}`, template: `${titlePrefix()}%s · ${brand.name}` },
    appleWebApp: { capable: true, statusBarStyle: 'default', title: brand.name },
    ...(brand.mark.light ? { icons: { icon: [{ url: brand.mark.light }], apple: [{ url: brand.mark.light }] } } : {}),
  };
}

/**
 * The signed-in shell. Reads the workspace the canonical URL names — the
 * proxy (`src/proxy.ts`) resolved the slug and set it on the request — and
 * hands it to the client context that every link builder reads. A page
 * reached without a workspace (onboarding, the demo sandbox) gets null and
 * plain, unprefixed links.
 *
 * The session is read here too and handed down, so the avatar and the unread
 * count render with the page instead of waiting on `/api/auth/session`, which
 * the client used to fetch twice before either could show.
 *
 * So is the Org's brand (`services/branding`): the signed-in person's Org,
 * or on a single-Org server the one Org, so sign-in and invite pages wear it
 * too. Its CSS is layered over the app's tokens here, once, and the sidebar
 * reads the logo from context.
 * @param props - `children`: the page.
 * @param props.children - The page.
 */
export default async function AuthLayout(props: {
  children: React.ReactNode;
}) {
  const [requestHeaders, session, brand] = await Promise.all([headers(), auth(), brandViewForRequest().catch(() => null)]);
  const slug = requestHeaders.get(WORKSPACE_HEADER.slug)?.trim() || null;

  return (
    <AuthProviders session={session} workspaceSlug={slug}>
      <OrgBrandStyle brand={brand} />
      <OrgBrandProvider value={brand}>{props.children}</OrgBrandProvider>
    </AuthProviders>
  );
}
