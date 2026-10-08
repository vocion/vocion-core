'use client';

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
