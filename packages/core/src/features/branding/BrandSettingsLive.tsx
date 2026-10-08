'use client';

import type { BrandApi, BrandSettingsProps } from './BrandSettings';
import type { OrgBrandFields } from '@/libs/branding/orgBrand';
import { client } from '@/libs/Orpc';
import { BrandSettings } from './BrandSettings';

/** The server calls behind Brand settings (`routers/Branding.ts`). */
const api: BrandApi = {
  save: fields => client.branding.save({ ...fields, website: fields.website ?? null }) as ReturnType<BrandApi['save']>,
  restore: brand => client.branding.restore({ brand: brand as Record<string, unknown> | null }) as ReturnType<BrandApi['restore']>,
  uploadLogo: input => client.branding.uploadLogo(input),
};

/**
 * Brand settings, wired to the server.
 * @param props - Everything but the calls.
 */
export function BrandSettingsLive(props: Omit<BrandSettingsProps, 'api' | 'draft'> & { draft: Partial<OrgBrandFields> | null }) {
  return <BrandSettings {...props} api={api} />;
}
