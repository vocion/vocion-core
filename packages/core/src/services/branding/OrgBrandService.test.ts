import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An Org's brand against PGlite: saved only through its check, scoped to its
 * Org, adopted from a workspace's brand.yaml once and never again, and the
 * guide a workspace's documents inherit.
 */

vi.mock('@/libs/DB');
let mode: 'single' | 'multi' = 'single';
vi.mock('@/services/OrgPolicy', () => ({ orgsMode: () => mode }));

const FIXTURE = path.resolve(__dirname, '..', '..', 'libs', 'branding', '__fixtures__', 'northwind');
const MEDIA = mkdtempSync(path.join(tmpdir(), 'brand-media-'));
process.env.VOCION_ARTIFACTS_DIR = MEDIA;
delete process.env.VOCION_MEDIA_BUCKET;
delete process.env.VOCION_WORKSPACE_MAP;

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const svc = await import('./OrgBrandService');
const { parseBrandAssetUrl, readBrandAsset } = await import('@/libs/tools/artifacts/media');
const { withFields, fieldsOf } = await import('@/libs/branding/orgBrand');

const NORTHWIND = 'acct-brand-northwind';
const KESTREL = 'acct-brand-kestrel';
const SUPPORT = 'proj-brand-support';

async function stored(accountId: string) {
  const [row] = await db.select({ brand: tenantAccountSchema.brand, seededAt: tenantAccountSchema.brandSeededAt }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId));
  return row!;
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-brand' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-brand' },
  ]);
  await db.insert(userSchema).values([{ id: 'usr-brand-dana', email: 'dana@northwind.example' }]);
  await db.insert(accountMembershipSchema).values([{ accountId: NORTHWIND, userId: 'usr-brand-dana', role: 'admin' }]);
  await db.insert(projectSchema).values({ id: SUPPORT, accountId: NORTHWIND, slug: 'support', name: 'Northwind Support' });
});

beforeEach(async () => {
  mode = 'single';
  process.env.WORKSPACE_PATH = FIXTURE;
  svc.forgetSeedAttempts();
  await db.update(tenantAccountSchema).set({ brand: null, brandSeededAt: null });
});

afterEach(() => {
  delete process.env.WORKSPACE_PATH;
});

describe('the one-time seed from a workspace brand.yaml', () => {
  it('adopts the guide: its logos kept in this Org\'s media store, cleaned; its palette and roles as written', async () => {
    const res = await svc.seedOrgBrandFromWorkspace(NORTHWIND);

    expect(res).toMatchObject({ seeded: true, from: path.join(FIXTURE, 'brand.yaml') });

    const brand = (await svc.getOrgBrand(NORTHWIND))!;

    expect(brand.name).toBe('Northwind');
    expect(brand.roles.accent).toBe('teal');
    expect(brand.senderName).toBe('Northwind Ops');

    for (const key of ['wordmark', 'wordmarkOnDark', 'mark'] as const) {
      const asset = parseBrandAssetUrl(brand.logos[key]!);

      expect(asset?.accountId).toBe(NORTHWIND);

      const file = await readBrandAsset(NORTHWIND, asset!.filename);

      expect(new TextDecoder().decode(file!.bytes)).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    }

    expect((await stored(NORTHWIND)).seededAt).toBeInstanceOf(Date);
  });

  it('runs once, ever: not again, and not after the brand is reset to the default', async () => {
    await svc.seedOrgBrandFromWorkspace(NORTHWIND);
    const first = await svc.getOrgBrand(NORTHWIND);

    expect(await svc.seedOrgBrandFromWorkspace(NORTHWIND)).toMatchObject({ seeded: false });
    expect(await svc.getOrgBrand(NORTHWIND)).toEqual(first);

    await svc.restoreOrgBrand(NORTHWIND, null);

    expect(await svc.seedOrgBrandFromWorkspace(NORTHWIND)).toMatchObject({ seeded: false });
    expect(await svc.getOrgBrand(NORTHWIND)).toBeNull();
  });

  it('happens on the first read in a process, so a deploy picks the file up with nobody opening a page', async () => {
    const view = await svc.brandViewForAccount(NORTHWIND);

    expect(view?.name).toBe('Northwind');
    expect(view?.accent?.fill).toBe('#0e8c7f');
    expect(view?.headingFont?.family).toBe('Space Grotesk');
  });

  it('is the server\'s own Org\'s alone: an Org nobody joined never adopts the server\'s file', async () => {
    expect(await svc.seedOrgBrandFromWorkspace(KESTREL)).toMatchObject({ seeded: false, reason: expect.stringContaining('server\'s own Org') });
    expect(await svc.brandViewForAccount(KESTREL)).toBeNull();
  });

  it('needs a file with logos or a palette, and never runs on a multi-Org server', async () => {
    process.env.WORKSPACE_PATH = mkdtempSync(path.join(tmpdir(), 'brand-empty-'));

    expect(await svc.seedOrgBrandFromWorkspace(NORTHWIND)).toMatchObject({ seeded: false, reason: expect.stringContaining('no workspace brand.yaml') });
    // Nothing to adopt is not "seeded": a file added later is still adopted.
    expect((await stored(NORTHWIND)).seededAt).toBeNull();

    process.env.WORKSPACE_PATH = FIXTURE;
    mode = 'multi';

    expect(await svc.seedOrgBrandFromWorkspace(NORTHWIND)).toMatchObject({ seeded: false });
    expect(await svc.getOrgBrand(NORTHWIND)).toBeNull();
  });
});

describe('saving, scoped to one Org', () => {
  async function northwindLogo() {
    const kept = await svc.importBrandLogo({ accountId: NORTHWIND, name: 'logo', bytes: new TextEncoder().encode('<svg viewBox="0 0 2 2"><rect width="2" height="2" fill="#0e8c7f"/></svg>'), contentType: 'image/svg+xml' });
    return kept.ok ? kept.url : '';
  }

  it('saves a checked brand and says what it was before', async () => {
    const logo = await northwindLogo();
    const res = await svc.saveOrgBrand({ accountId: NORTHWIND, brand: withFields(null, { name: 'Northwind', accent: '#0E8C7F', headingFont: null, senderName: null, logos: { wordmark: logo } }) });

    expect(res.before).toBeNull();
    expect(fieldsOf(res.after)).toMatchObject({ name: 'Northwind', accent: '#0e8c7f', logos: { wordmark: logo } });
    // Saving is a decision about the brand: the seed never overrules it.
    expect((await stored(NORTHWIND)).seededAt).toBeInstanceOf(Date);
  });

  it('refuses an accent that cannot be worn, with the reason, and writes nothing', async () => {
    await expect(svc.saveOrgBrand({ accountId: NORTHWIND, brand: withFields(null, { name: 'Northwind', accent: '#FFFF00', headingFont: null, senderName: null, logos: {} }) }))
      .rejects
      .toThrow(/Pick a deeper shade/);
    expect(await svc.getOrgBrand(NORTHWIND)).toBeNull();
  });

  it('refuses another Org\'s logo, or a link to somewhere else', async () => {
    const logo = await northwindLogo();

    await expect(svc.saveOrgBrand({ accountId: KESTREL, brand: withFields(null, { name: 'Kestrel Capital', accent: null, headingFont: null, senderName: null, logos: { wordmark: logo } }) }))
      .rejects
      .toThrow(/not a file this Org keeps/);
    await expect(svc.saveOrgBrand({ accountId: KESTREL, brand: withFields(null, { name: 'Kestrel Capital', accent: null, headingFont: null, senderName: null, logos: { mark: 'https://kestrel.example/logo.svg' } }) }))
      .rejects
      .toThrow(/not a file this Org keeps/);
    // And a name cannot reach another Org's file in the store.
    expect(await readBrandAsset(KESTREL, parseBrandAssetUrl(logo)!.filename)).toBeNull();
  });

  it('each Org wears its own brand; one Org\'s save is invisible to the other', async () => {
    await svc.saveOrgBrand({ accountId: NORTHWIND, brand: withFields(null, { name: 'Northwind', accent: '#0E8C7F', headingFont: null, senderName: null, logos: {} }) });

    expect(await svc.getOrgBrand(KESTREL)).toBeNull();
    expect(await svc.brandViewForAccount(KESTREL)).toBeNull();
    expect((await svc.brandViewForAccount(NORTHWIND))?.name).toBe('Northwind');
  });

  it('the server\'s one Org is the one people belong to', async () => {
    expect(await svc.installAccountId()).toBe(NORTHWIND);

    mode = 'multi';

    expect(await svc.installAccountId()).toBeNull();
  });
});

describe('documentBrandFor — what a workspace\'s documents wear', () => {
  it('is the Org\'s brand with the workspace\'s brand.yaml over it, logos inlined', async () => {
    await svc.seedOrgBrandFromWorkspace(NORTHWIND);
    const ws = mkdtempSync(path.join(tmpdir(), 'brand-ws-'));
    writeFileSync(path.join(ws, 'brand.yaml'), 'palette:\n  teal: "#1F6FEB"\nvoice:\n  - Warm. Short sentences.\n');
    process.env.WORKSPACE_PATH = ws;

    const { brand, issues } = await svc.documentBrandFor(SUPPORT);

    expect(issues).toEqual([]);
    expect(brand?.brand.name).toBe('Northwind');
    expect(brand?.brand.palette.teal).toBe('#1F6FEB');
    expect(brand?.brand.palette.navy).toBe('#12355B');
    expect(brand?.brand.voice).toEqual(['Warm. Short sentences.']);
    expect(brand?.logos.wordmark).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(brand?.cssRoot).toContain('--accent:var(--brand-teal);');
  });

  it('with no Org brand, a file without a name is an issue, not a brand', async () => {
    const ws = mkdtempSync(path.join(tmpdir(), 'brand-ws-'));
    writeFileSync(path.join(ws, 'brand.yaml'), 'palette:\n  teal: "#1F6FEB"\n');
    process.env.WORKSPACE_PATH = ws;
    mode = 'multi';

    const { brand, issues } = await svc.documentBrandFor(SUPPORT);

    expect(brand).toBeNull();
    expect(issues[0]?.message).toContain('name: Required');
  });
});
