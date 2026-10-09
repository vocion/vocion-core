'use client';

import type { BrandChrome } from '@/libs/branding/chrome';
import type { OrgBrandView } from '@/libs/branding/orgBrand';
import { createContext, use } from 'react';

/**
 * The Org's brand, for client components (the sidebar, the rail) that wear
 * it. Read on the server once per request (`brandViewForRequest`) and handed
 * down by the signed-in layout; null is Vocion's own look.
 */
const OrgBrandContext = createContext<OrgBrandView | null>(null);

export const OrgBrandProvider = OrgBrandContext.Provider;

/** The Org's brand, or null for Vocion's own look. */
export function useOrgBrand(): OrgBrandView | null {
  return use(OrgBrandContext);
}

/** Vocion leads with its wordmark in the footer: the chrome of an install nobody configured. */
const DEFAULT_CHROME: BrandChrome = { lead: 'vocion', footer: 'vocion-wordmark' };

const BrandChromeContext = createContext<BrandChrome>(DEFAULT_CHROME);

/** Which brand each region shows (`libs/branding/chrome.ts`), read once per request by the signed-in layout. */
export const BrandChromeProvider = BrandChromeContext.Provider;

/** Which brand each region of the chrome shows. */
export function useBrandChrome(): BrandChrome {
  return use(BrandChromeContext);
}
