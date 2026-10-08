import type { OrgBrandFields } from '@/libs/branding/orgBrand';
import type { BrandManifest } from '@/libs/workspace/brandSchema';
import { Buffer } from 'node:buffer';
import { os } from '@orpc/server';
import { z } from 'zod';
import { fieldsOf, withFields } from '@/libs/branding/orgBrand';
import { BRAND_ASSET_MAX_BYTES } from '@/libs/tools/artifacts/media';
import { BrandManifestSchema } from '@/libs/workspace/brandSchema';
import { BrandRefusedError, getOrgBrand, importBrandLogo, restoreOrgBrand, saveOrgBrand } from '@/services/branding/OrgBrandService';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Brand settings — an Org admin's edits to the Org's brand
 * (`services/branding/OrgBrandService.ts`). Every procedure is scoped to the
 * caller's own Org (the session's `accountId`); none takes an Org id.
 */

/** Admins of the caller's Org only. */
async function guardBrandAdmin() {
  const ctx = await guardAuth();
  if (!ctx.has({ role: ORG_ROLE.ADMIN }) || !ctx.accountId) {
    throw ApiError.forbidden();
  }
  return { accountId: ctx.accountId };
}

const LOGO_KEYS = ['wordmark', 'wordmarkOnDark', 'mark', 'markOnDark'] as const;
const LogoRef = z.string().trim().min(1).max(4096);

const FieldsZ = z.object({
  name: z.string().trim().min(1, 'The brand needs a name.').max(80),
  accent: z.string().trim().regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour like #1F6FEB.').nullable(),
  headingFont: z.string().trim().max(60).nullable(),
  senderName: z.string().trim().max(80).nullable(),
  logos: z.object({ wordmark: LogoRef.optional(), wordmarkOnDark: LogoRef.optional(), mark: LogoRef.optional(), markOnDark: LogoRef.optional() }),
  website: z.string().trim().url().max(500).nullable().optional(),
});

/** The Org's brand as the page edits it; null fields when it has none. */
export const get = os.handler(async () => {
  const { accountId } = await guardBrandAdmin();
  const brand = await getOrgBrand(accountId);
  return { fields: brand ? fieldsOf(brand) : null, brand };
});

/**
 * Save the brand. A logo still on another site (a drafted brand's) is fetched
 * and kept first; the accent is checked; a refusal comes back as the sentence
 * the person reads. Returns what it was before, for the page's Undo.
 */
export const save = os
  .input(FieldsZ)
  .handler(async ({ input }) => {
    const { accountId } = await guardBrandAdmin();
    const logos: OrgBrandFields['logos'] = {};
    for (const key of LOGO_KEYS) {
      const ref = input.logos[key];
      if (!ref) {
        continue;
      }
      const kept = await importBrandLogo({ accountId, name: key, url: ref });
      if (!kept.ok) {
        throw ApiError.badRequest(`The ${key.startsWith('mark') ? 'mark' : 'logo'} could not be kept: ${kept.reason}`);
      }
      logos[key] = kept.url;
    }
    try {
      const base = await getOrgBrand(accountId);
      const saved = await saveOrgBrand({ accountId, brand: withFields(base, { ...input, website: input.website ?? null, logos }) });
      return { before: saved.before, fields: fieldsOf(saved.after), notes: saved.notes };
    } catch (err) {
      if (err instanceof BrandRefusedError) {
        throw ApiError.badRequest(err.message);
      }
      throw err;
    }
  });

/**
 * Put the brand back to a guide the page held (Undo), or to none — Vocion's
 * own look ("Reset to default"). Returns what it was before.
 */
export const restore = os
  .input(z.object({ brand: z.record(z.string(), z.unknown()).nullable() }))
  .handler(async ({ input }) => {
    const { accountId } = await guardBrandAdmin();
    const before = await getOrgBrand(accountId);
    if (input.brand === null) {
      await restoreOrgBrand(accountId, null);
      return { before, fields: null };
    }
    const parsed = BrandManifestSchema.safeParse(input.brand);
    if (!parsed.success) {
      throw ApiError.badRequest('That brand could not be read.');
    }
    try {
      const saved = await saveOrgBrand({ accountId, brand: parsed.data as BrandManifest });
      return { before, fields: fieldsOf(saved.after) };
    } catch (err) {
      if (err instanceof BrandRefusedError) {
        throw ApiError.badRequest(err.message);
      }
      throw err;
    }
  });

/** Upload a logo or a mark (an SVG, cleaned, or a PNG; other rasters become PNG). Returns its URL. */
export const uploadLogo = os
  .input(z.object({
    kind: z.enum(LOGO_KEYS),
    contentType: z.string().max(100),
    /** The file, base64. A logo is kilobytes; the cap is checked on the bytes. */
    dataBase64: z.string().min(1).max(Math.ceil((BRAND_ASSET_MAX_BYTES * 4) / 3) * 4 + 16),
  }))
  .handler(async ({ input }) => {
    const { accountId } = await guardBrandAdmin();
    const bytes = new Uint8Array(Buffer.from(input.dataBase64, 'base64'));
    const kept = await importBrandLogo({ accountId, name: input.kind, bytes, contentType: input.contentType });
    if (!kept.ok) {
      throw ApiError.badRequest(`That file can't be used: ${kept.reason}`);
    }
    return { url: kept.url };
  });
