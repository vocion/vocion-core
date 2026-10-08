import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Use this brand": the drafted brand applied as the person's own action,
 * only by an Org admin, with the accent checked before anything is written,
 * and Undo putting the previous brand back — unless someone changed it since.
 */

vi.mock('@/libs/DB');
vi.mock('@/services/OrgPolicy', () => ({ orgsMode: () => 'single' }));
process.env.VOCION_ARTIFACTS_DIR = mkdtempSync(path.join(tmpdir(), 'brand-apply-'));
delete process.env.VOCION_MEDIA_BUCKET;
delete process.env.WORKSPACE_PATH;

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { orgBrandApplyAction } = await import('./org-brand-apply');
const { getOrgBrand, importBrandLogo, saveOrgBrand } = await import('@/services/branding/OrgBrandService');
const { withFields } = await import('@/libs/branding/orgBrand');

const ACCOUNT = 'acct-apply-northwind';
const ORG = 'proj-apply-support';
const DANA = 'usr-apply-dana';
const OMAR = 'usr-apply-omar';

const asPerson = (userId: string) => ({ orgId: ORG, invokedBy: userId, origin: { userId, byPerson: true } });
let logo = '';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-apply' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCOUNT, slug: 'support', name: 'Northwind Support' });
  await db.insert(userSchema).values([{ id: DANA, email: 'dana@northwind.example' }, { id: OMAR, email: 'omar@northwind.example' }]);
  await db.insert(accountMembershipSchema).values([{ accountId: ACCOUNT, userId: DANA, role: 'admin' }, { accountId: ACCOUNT, userId: OMAR, role: 'member' }]);
  const kept = await importBrandLogo({ accountId: ACCOUNT, name: 'logo', bytes: new TextEncoder().encode('<svg viewBox="0 0 2 2"><rect width="2" height="2" fill="#0e8c7f"/></svg>'), contentType: 'image/svg+xml' });
  logo = kept.ok ? kept.url : '';
});

beforeEach(async () => {
  await db.update(tenantAccountSchema).set({ brand: null, brandSeededAt: null });
});

const draft = () => orgBrandApplyAction.inputSchema.parse({ name: 'Northwind', accent: '#0E8C7F', headingFont: 'Space Grotesk', senderName: 'Northwind Ops', logos: { wordmark: logo, mark: 'https://localhost/favicon.png' }, website: 'https://northwind.example' });

describe('org.brand_apply', () => {
  it('applies the draft for an admin: logos kept, accent checked, the brand worn', async () => {
    const result = await orgBrandApplyAction.execute(asPerson(DANA), draft());
    const brand = await getOrgBrand(ACCOUNT);

    expect(result).toMatchObject({ applied: true, name: 'Northwind', before: null });
    expect(brand?.logos.wordmark).toBe(logo);
    expect(brand?.palette.accent).toBe('#0e8c7f');
    expect(brand?.senderName).toBe('Northwind Ops');
    // A logo that could not be fetched is left out, and said — not a failure.
    expect(brand?.logos.mark).toBeUndefined();
    expect((result.notes as string[]).join(' ')).toContain('The mark was left out');
  });

  it('only an Org admin: refused at the door for a member, and again on execute', async () => {
    expect(await orgBrandApplyAction.precheck!(asPerson(OMAR), draft())).toContain('only an Org admin');
    await expect(orgBrandApplyAction.execute(asPerson(OMAR), draft())).rejects.toThrow(/Only an Org admin/);
    expect(await getOrgBrand(ACCOUNT)).toBeNull();
  });

  it('refuses an accent that cannot be worn before anything runs, with the reason', async () => {
    expect(await orgBrandApplyAction.precheck!(asPerson(DANA), { ...draft(), accent: '#FFFF00' })).toContain('Pick a deeper shade');
  });

  it('Undo puts back the brand the Org had', async () => {
    const before = await saveOrgBrand({ accountId: ACCOUNT, brand: withFields(null, { name: 'Northwind Freight', accent: '#12355B', headingFont: null, senderName: null, logos: {} }) });
    const input = draft();
    const result = await orgBrandApplyAction.execute(asPerson(DANA), input);

    expect((await getOrgBrand(ACCOUNT))?.name).toBe('Northwind');

    // The run's result is read back from jsonb, as the undo path reads it.
    const undone = await orgBrandApplyAction.undo!(asPerson(DANA), input, JSON.parse(JSON.stringify(result)));

    expect(undone).toMatchObject({ undone: true, restored: 'Northwind Freight' });
    expect(await getOrgBrand(ACCOUNT)).toEqual(before.after);
  });

  it('Undo of a first brand goes back to Vocion\'s own look', async () => {
    const input = draft();
    const result = await orgBrandApplyAction.execute(asPerson(DANA), input);
    await orgBrandApplyAction.undo!(asPerson(DANA), input, JSON.parse(JSON.stringify(result)));

    expect(await getOrgBrand(ACCOUNT)).toBeNull();
  });

  it('Undo will not throw away a change made since', async () => {
    const input = draft();
    const result = await orgBrandApplyAction.execute(asPerson(DANA), input);
    await saveOrgBrand({ accountId: ACCOUNT, brand: withFields(await getOrgBrand(ACCOUNT), { name: 'Northwind', accent: '#7C3CFF', headingFont: null, senderName: null, logos: { wordmark: logo } }) });

    await expect(orgBrandApplyAction.undo!(asPerson(DANA), input, JSON.parse(JSON.stringify(result)))).rejects.toThrow(/changed since/);
    expect((await getOrgBrand(ACCOUNT))?.palette.accent).toBe('#7c3cff');
  });
});
