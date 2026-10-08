'use client';

import { VocionLogo } from '@/templates/VocionLogo';
import { cn } from '@/utils/Helpers';
import { useOrgBrand } from './BrandContext';
import { OrgLogo, PoweredByVocion } from './OrgLogo';

/**
 * The logo at the top of sign-in, an invite and an email-link landing: the
 * Org's, when the server knows whose page this is (the one Org of a
 * single-Org server, or the invite's), else Vocion's.
 */
export function AuthBrandLogo() {
  const brand = useOrgBrand();
  return brand ? <OrgLogo brand={brand} size="lg" /> : <VocionLogo size="lg" plain />;
}

/**
 * "Powered by Vocion" under an Org's sign-in card; nothing when the page is Vocion's own, or white-labelled.
 * @param root0
 * @param root0.className
 */
export function AuthPoweredBy({ className }: { className?: string }) {
  const brand = useOrgBrand();
  return brand?.poweredBy ? <div className={cn('mt-4 flex justify-center', className)}><PoweredByVocion /></div> : null;
}

/**
 * Classes for the page's one primary button: the Org's accent as a fill with
 * its AA text colour, when it has one; the app's ink otherwise (`undefined`
 * keeps the button's own variant).
 */
export function useAccentButtonClass(): string | undefined {
  const brand = useOrgBrand();
  return brand?.accent ? 'bg-org-accent text-org-accent-foreground hover:bg-org-accent/90' : undefined;
}

/**
 * Who may get in, as the sign-in page says it: the install's Org (a
 * single-Org server knows it before anyone signs in; a multi-Org server does
 * not), and the domains that join without an invite (`VOCION_AUTO_JOIN_DOMAINS`)
 * with the providers that prove them.
 */
export type SignInAccess = { org: string | null; autoJoin: { domains: string[]; providers: string[] } | null };

/** The name sign-in says it is signing in to: the Org's, or "your workspace". */
export function useSignInTarget(): string | null {
  return useOrgBrand()?.name ?? null;
}
