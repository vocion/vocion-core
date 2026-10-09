/**
 * AN ORG'S BRAND — kept on the Org, worn by everything the Org's people see.
 *
 * The brand is the brand guide (`libs/workspace/brand.ts`), stored on the
 * `tenant_account` row (migration 0199) with its logos in the media store
 * (`keepBrandAsset`). This is the only place that reads or writes it:
 *
 * - `getOrgBrand` / `saveOrgBrand` / `restoreOrgBrand` — the row, checked on
 *   the way in (`checkOrgBrand`: a schema the guide must pass and an accent
 *   that must be wearable, refused with a sentence otherwise). Every write is
 *   keyed on one Org id; nothing here reads across Orgs.
 * - `brandViewForAccount` / `brandViewForRequest` — what a page wears: the
 *   signed-in person's Org, or on a single-Org server the one Org, so the
 *   sign-in page is branded before anyone signs in.
 * - `seedOrgBrandFromWorkspace` — the one-time adoption of a workspace's
 *   `brand.yaml` by an Org with no brand (single-Org servers only). It runs
 *   once per Org, ever (`brand_seeded_at`), so resetting the brand to the
 *   default is never overruled by the next deploy.
 * - `documentBrandFor` — the guide a document uses: the Org's, with the
 *   workspace's `brand.yaml` over it (`inheritBrand`).
 * - `importBrandLogo` — a logo from a URL (a drafted brand's) or from bytes,
 *   into the media store, as an SVG rebuilt from an allowlist or a PNG.
 */

import type { BrandChrome } from '@/libs/branding/chrome';
import type { BrandCheck, OrgBrandView } from '@/libs/branding/orgBrand';
import type { BrandLoadIssue, BrandLogoKey, BrandManifest, LoadedBrand } from '@/libs/workspace/brand';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';
import { brandChrome, leadBrandSetting } from '@/libs/branding/chrome';
import { brandView, checkOrgBrand } from '@/libs/branding/orgBrand';
import { db } from '@/libs/DB';
import { extensionWhiteLabel } from '@/libs/extensions';
import { BRAND_ASSET_MAX_BYTES, keepBrandAsset, parseBrandAssetUrl, readBrandAsset } from '@/libs/tools/artifacts/media';
import { BRAND_LOGO_KEYS, BrandManifestSchema, inheritBrand, loadBrand, logoDataUri, readWorkspaceBrandFile } from '@/libs/workspace/brand';
import { getWorkspacePath } from '@/libs/workspace/reader';
import { accountMembershipSchema, projectSchema, tenantAccountSchema } from '@/models/Schema';
import { orgsMode } from '@/services/OrgPolicy';

/** A brand that cannot be saved, worded for the person who tried. */
export class BrandRefusedError extends Error {
  readonly code = 'BRAND_REFUSED';
}

/**
 * The Org's brand as stored, or null when it has none (or what is stored no
 * longer parses, which is read as none rather than drawn broken).
 * @param accountId - The Org (`tenant_account.id`).
 */
export async function getOrgBrand(accountId: string): Promise<BrandManifest | null> {
  const [row] = await db.select({ brand: tenantAccountSchema.brand }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId)).limit(1);
  if (!row?.brand) {
    return null;
  }
  const parsed = BrandManifestSchema.safeParse(row.brand);
  return parsed.success ? parsed.data : null;
}

/**
 * Check a guide for an Org: it parses, its accent is wearable, and every logo
 * is a file this Org keeps in the media store (never another Org's, never a
 * link to somewhere else).
 * @param accountId - The Org it is for.
 * @param raw - The guide.
 */
export function checkBrandForAccount(accountId: string, raw: unknown): BrandCheck {
  const checked = checkOrgBrand(raw);
  if (!checked.ok) {
    return checked;
  }
  for (const key of BRAND_LOGO_KEYS) {
    const ref = checked.brand.logos[key];
    if (!ref) {
      continue;
    }
    const asset = parseBrandAssetUrl(ref);
    if (!asset || asset.accountId !== accountId) {
      return { ok: false, reason: `The ${key === 'mark' || key === 'markOnDark' ? 'mark' : 'logo'} has to be uploaded here first: "${ref.slice(0, 80)}" is not a file this Org keeps.` };
    }
  }
  return checked;
}

/**
 * Save an Org's brand. Refused, with the reason, when the guide does not pass
 * `checkBrandForAccount`.
 * @param input - What to save.
 * @param input.accountId - The Org.
 * @param input.brand - The guide.
 * @returns What it was before (for Undo) and what it is now, with any notes on what was adjusted.
 */
export async function saveOrgBrand(input: { accountId: string; brand: unknown }): Promise<{ before: BrandManifest | null; after: BrandManifest; notes: string[] }> {
  const checked = checkBrandForAccount(input.accountId, input.brand);
  if (!checked.ok) {
    throw new BrandRefusedError(checked.reason);
  }
  const before = await getOrgBrand(input.accountId);
  const updated = await db
    .update(tenantAccountSchema)
    .set({ brand: checked.brand as unknown as Record<string, unknown>, brandSeededAt: new Date() })
    .where(eq(tenantAccountSchema.id, input.accountId))
    .returning({ id: tenantAccountSchema.id });
  if (updated.length === 0) {
    throw new BrandRefusedError('That Org could not be found.');
  }
  return { before, after: checked.brand, notes: checked.notes };
}

/**
 * Put an Org's brand back to what it was — a guide, or null for Vocion's own
 * look. Undo and "Reset to default" both land here. Never re-seeds: the Org
 * is marked seeded, so a reset stays a reset.
 * @param accountId - The Org.
 * @param brand - What to restore; null clears it.
 */
export async function restoreOrgBrand(accountId: string, brand: BrandManifest | null): Promise<void> {
  const parsed = brand === null ? null : BrandManifestSchema.parse(brand);
  await db
    .update(tenantAccountSchema)
    .set({ brand: parsed as unknown as Record<string, unknown> | null, brandSeededAt: new Date() })
    .where(eq(tenantAccountSchema.id, accountId));
}

/**
 * The one Org of a single-Org server: the Org people belong to. Null on a
 * multi-Org server, where an Org is only known from who is asking, and on a
 * server nobody has joined yet.
 */
export async function installAccountId(): Promise<string | null> {
  if (orgsMode() === 'multi') {
    return null;
  }
  const [row] = await db
    .select({ id: tenantAccountSchema.id })
    .from(tenantAccountSchema)
    .innerJoin(accountMembershipSchema, eq(accountMembershipSchema.accountId, tenantAccountSchema.id))
    .orderBy(asc(tenantAccountSchema.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The Org a workspace belongs to.
 * @param orgId - The workspace (`project.id`).
 */
export async function accountOfWorkspace(orgId: string): Promise<string | null> {
  const [row] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return row?.accountId ?? null;
}

/** Orgs whose seed this process has already tried, so a page render looks at the disk once. */
const seedTried = new Set<string>();

/** For tests: forget which Orgs this process tried to seed. */
export function forgetSeedAttempts(): void {
  seedTried.clear();
}

/**
 * The folders a workspace of this Org reads its files from, the server's
 * `WORKSPACE_PATH` last.
 * @param accountId - The Org.
 */
async function workspaceFoldersOf(accountId: string): Promise<string[]> {
  const { workspaceFolderForProject } = await import('@/libs/workspace/project-path');
  const projects = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(and(eq(projectSchema.accountId, accountId), eq(projectSchema.kind, 'shared')))
    .orderBy(asc(projectSchema.createdAt));
  const folders: string[] = [];
  for (const p of projects) {
    const folder = await workspaceFolderForProject(p.id).catch(() => null);
    if (folder?.path) {
      folders.push(folder.path);
    }
  }
  const env = getWorkspacePath();
  if (env) {
    folders.push(env);
  }
  return [...new Set(folders.map(f => resolve(f)))];
}

const LOGO_FILE_TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png' };

/**
 * A workspace logo file into the Org's media store.
 * @param accountId - The Org.
 * @param key - Which logo.
 * @param ref - The path as `brand.yaml` wrote it.
 * @param base - The folder `brand.yaml` is in.
 */
async function importWorkspaceLogo(accountId: string, key: BrandLogoKey, ref: string, base: string): Promise<{ url: string } | { reason: string }> {
  if (ref.startsWith('data:')) {
    const m = /^data:(image\/(?:svg\+xml|png))(;base64)?,([\s\S]*)$/.exec(ref);
    if (!m) {
      return { reason: 'only an SVG or PNG data URI can be kept' };
    }
    const bytes = m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!), 'utf8');
    const kept = await keepBrandAsset({ accountId, name: key, data: bytes, contentType: m[1]! });
    return kept.ok ? { url: kept.url } : { reason: kept.reason };
  }
  const abs = isAbsolute(ref) ? ref : resolve(base, ref);
  const type = LOGO_FILE_TYPES[extname(abs).toLowerCase()];
  if (!abs.startsWith(resolve(base)) || !type) {
    return { reason: `"${ref}" is not an SVG or PNG under the workspace` };
  }
  try {
    const kept = await keepBrandAsset({ accountId, name: key, data: await readFile(abs), contentType: type });
    return kept.ok ? { url: kept.url } : { reason: kept.reason };
  } catch {
    return { reason: `"${ref}" could not be read` };
  }
}

export type SeedResult = { seeded: true; from: string; notes: string[] } | { seeded: false; reason: string };

/**
 * ADOPT A WORKSPACE'S brand.yaml, ONCE.
 *
 * The one Org of a single-Org server, with no brand, takes the first `brand.yaml`
 * among its workspaces' folders that has logos or a palette: its logos are
 * copied into the media store, a logo that cannot be kept is left out (and
 * said), and an accent that cannot be worn is left out rather than refused.
 * Then the Org is marked seeded, and this never runs for it again — not after
 * a reset to default, not on the next deploy. Idempotent and race-safe: the
 * write lands only while the Org is still unbranded and unseeded.
 * @param accountId - The Org.
 */
export async function seedOrgBrandFromWorkspace(accountId: string): Promise<SeedResult> {
  if (orgsMode() === 'multi') {
    return { seeded: false, reason: 'an Org on a multi-Org server is branded by its admins, never from a server folder' };
  }
  // The server's folders are the server's one Org's: never another row's (the
  // empty Default every database has, an Org nobody joined).
  if ((await installAccountId()) !== accountId) {
    return { seeded: false, reason: 'only the server\'s own Org adopts its workspace\'s brand.yaml' };
  }
  const [row] = await db
    .select({ brand: tenantAccountSchema.brand, seededAt: tenantAccountSchema.brandSeededAt })
    .from(tenantAccountSchema)
    .where(eq(tenantAccountSchema.id, accountId))
    .limit(1);
  if (!row) {
    return { seeded: false, reason: 'no such Org' };
  }
  if (row.seededAt || row.brand) {
    return { seeded: false, reason: 'this Org already has a brand, or had one' };
  }
  for (const folder of await workspaceFoldersOf(accountId)) {
    const read = readWorkspaceBrandFile(folder);
    const file = read.override;
    if (!read.file || !file?.name || (Object.keys(file.logos).length === 0 && Object.keys(file.palette).length === 0)) {
      continue;
    }
    const guide = inheritBrand(null, file)!;
    const notes: string[] = [];
    const logos: BrandManifest['logos'] = {};
    for (const key of BRAND_LOGO_KEYS) {
      const ref = guide.logos[key];
      if (!ref) {
        continue;
      }
      const got = await importWorkspaceLogo(accountId, key, ref, dirname(read.file));
      if ('url' in got) {
        logos[key] = got.url;
      } else {
        notes.push(`logos.${key} left out: ${got.reason}`);
      }
    }
    let seed: BrandManifest = { ...guide, logos };
    const checked = checkOrgBrand(seed);
    if (!checked.ok) {
      const { accent: _dropped, ...roles } = seed.roles;
      seed = { ...seed, roles };
      notes.push(`accent left out: ${checked.reason}`);
    }
    const written = await db
      .update(tenantAccountSchema)
      .set({ brand: seed as unknown as Record<string, unknown>, brandSeededAt: new Date() })
      .where(and(eq(tenantAccountSchema.id, accountId), isNull(tenantAccountSchema.brand), isNull(tenantAccountSchema.brandSeededAt)))
      .returning({ id: tenantAccountSchema.id });
    return written.length > 0 ? { seeded: true, from: read.file, notes } : { seeded: false, reason: 'another request seeded it first' };
  }
  return { seeded: false, reason: 'no workspace brand.yaml with logos or a palette' };
}

/**
 * What an Org's pages wear, or null for Vocion's own look. The first read in
 * a process on a single-Org server also tries the one-time seed, so a server
 * whose workspace carries a brand.yaml is branded after its next deploy
 * without anyone opening a settings page.
 * @param accountId - The Org.
 */
export async function brandViewForAccount(accountId: string): Promise<OrgBrandView | null> {
  let brand = await getOrgBrand(accountId);
  if (!brand && !seedTried.has(accountId)) {
    seedTried.add(accountId);
    const seeded = await seedOrgBrandFromWorkspace(accountId).catch(() => null);
    if (seeded?.seeded) {
      brand = await getOrgBrand(accountId);
    }
  }
  return brand ? brandView(brand, { whiteLabel: extensionWhiteLabel() }) : null;
}

/**
 * The Org this request is about: the signed-in person's, else on a
 * single-Org server the one Org (so sign-in is branded), else none.
 */
export const accountIdForRequest = cache(async (): Promise<string | null> => {
  const { auth } = await import('@/libs/Auth');
  const session = await auth().catch(() => null);
  return session?.user?.accountId ?? installAccountId();
});

/** What this request's pages wear — read once per request however many places ask. */
export const brandViewForRequest = cache(async (): Promise<OrgBrandView | null> => {
  const accountId = await accountIdForRequest();
  return accountId ? brandViewForAccount(accountId).catch(() => null) : null;
});

/**
 * Which brand each region of the chrome shows for this request
 * (`libs/branding/chrome.ts`): the install's lead brand in the top bar and
 * the tab, the other quietly in the drawer footer.
 */
export const brandChromeForRequest = cache(async (): Promise<BrandChrome> => {
  const brand = await brandViewForRequest();
  return brandChrome({ setting: leadBrandSetting(process.env.VOCION_LEAD_BRAND), orgsMode: orgsMode(), orgBranded: brand !== null, poweredBy: brand?.poweredBy ?? !extensionWhiteLabel() });
});

/**
 * A logo kept in the media store, as a data URI a document can inline.
 * @param ref - `/api/media/brand/<org>/<file>`.
 * @param accountId - The Org that must own it.
 */
async function brandAssetDataUri(ref: string, accountId: string | null): Promise<string | undefined> {
  if (ref.startsWith('data:')) {
    return ref;
  }
  const asset = parseBrandAssetUrl(ref);
  if (!asset || asset.accountId !== accountId) {
    return undefined;
  }
  const found = await readBrandAsset(asset.accountId, asset.filename);
  return found ? `data:${found.contentType};base64,${Buffer.from(found.bytes).toString('base64')}` : undefined;
}

/**
 * THE GUIDE A DOCUMENT USES in this workspace: the Org's brand with the
 * workspace's `brand.yaml` over it. A field the file writes wins; anything it
 * leaves out is the Org's. A file that cannot be read is an issue, and the
 * Org's brand still stands.
 * @param orgId - The workspace (`project.id`).
 */
export async function documentBrandFor(orgId: string): Promise<{ brand: LoadedBrand | null; issues: BrandLoadIssue[] }> {
  const accountId = await accountOfWorkspace(orgId);
  const org = accountId ? await getOrgBrand(accountId) : null;
  const { workspaceFolderForProject } = await import('@/libs/workspace/project-path');
  const folder = (await workspaceFolderForProject(orgId).catch(() => null))?.path ?? null;
  const read = readWorkspaceBrandFile(folder);
  const issues = [...read.issues];
  const brand = inheritBrand(org, read.override);
  if (!brand) {
    if (read.file && read.override) {
      issues.push({ file: read.file, message: 'name: Required — name the company, or give the Org a brand (Brand settings) for this file to inherit' });
    }
    return { brand: null, issues };
  }
  const fileLogos = read.override?.logos ?? {};
  const base = read.file ? dirname(read.file) : null;
  const loaded = await loadBrand(brand, read.file ?? 'Org brand', (key, ref) => (base && fileLogos[key] === ref ? logoDataUri(ref, base) : brandAssetDataUri(ref, accountId)));
  return { brand: loaded.brand, issues: [...issues, ...loaded.issues] };
}

/** Raster types converted to PNG on the way in; an SVG or a PNG is kept as it is. */
const CONVERTIBLE = new Set(['jpeg', 'gif', 'webp', 'avif', 'bmp']);

/**
 * A logo into this Org's media store, from a URL (a public address only, on
 * every redirect) or from bytes a person uploaded. An SVG is rebuilt from the
 * allowlist; a PNG kept, or shrunk when it is over the size a logo may be; a
 * JPEG, WebP or GIF converted to PNG. A media URL this Org already keeps is
 * returned as it is.
 * @param input - What to keep.
 * @param input.accountId - The Org.
 * @param input.name - What the file is (`logo`, `mark`).
 * @param input.url - Where it is, for a drafted brand.
 * @param input.bytes - The file, for an upload.
 * @param input.contentType - The upload's declared type.
 */
export async function importBrandLogo(input: { accountId: string; name: string; url?: string; bytes?: Uint8Array; contentType?: string }): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  if (input.url) {
    const own = parseBrandAssetUrl(input.url);
    if (own) {
      return own.accountId === input.accountId ? { ok: true, url: input.url } : { ok: false, reason: 'that file belongs to another Org' };
    }
  }
  let bytes: Uint8Array;
  let kind: string;
  if (input.bytes) {
    const { sniffImage } = await import('@/libs/tools/image/inspect');
    bytes = input.bytes;
    kind = sniffImage(Buffer.from(bytes)) ?? '';
  } else if (input.url) {
    const { fetchImageBytes, ImageFetchError } = await import('@/libs/tools/image/remote');
    try {
      const got = await fetchImageBytes(input.url, { maxFetchBytes: 4 * 1024 * 1024 });
      bytes = new Uint8Array(got.bytes);
      kind = got.kind;
    } catch (err) {
      return { ok: false, reason: err instanceof ImageFetchError ? err.message : 'the logo could not be fetched' };
    }
  } else {
    return { ok: false, reason: 'no file to keep' };
  }
  if (kind === 'svg') {
    const kept = await keepBrandAsset({ accountId: input.accountId, name: input.name, data: bytes, contentType: 'image/svg+xml' });
    return kept.ok ? { ok: true, url: kept.url } : { ok: false, reason: kept.reason };
  }
  if (kind === 'png' && bytes.byteLength <= BRAND_ASSET_MAX_BYTES) {
    const kept = await keepBrandAsset({ accountId: input.accountId, name: input.name, data: bytes, contentType: 'image/png' });
    return kept.ok ? { ok: true, url: kept.url } : { ok: false, reason: kept.reason };
  }
  if (kind === 'png' || CONVERTIBLE.has(kind)) {
    const sharp = (await import('sharp')).default;
    try {
      const png = await sharp(Buffer.from(bytes), { failOn: 'error' }).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      const kept = await keepBrandAsset({ accountId: input.accountId, name: input.name, data: new Uint8Array(png), contentType: 'image/png' });
      return kept.ok ? { ok: true, url: kept.url } : { ok: false, reason: kept.reason };
    } catch {
      return { ok: false, reason: 'that image could not be read' };
    }
  }
  return { ok: false, reason: kind === 'ico' ? 'an .ico favicon can\'t be kept; use an SVG or PNG mark' : 'a logo has to be an SVG or a PNG' };
}
