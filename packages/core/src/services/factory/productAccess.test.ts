import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, businessObjectSchema, sourceDekSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { storePlatformKey } = await import('@/services/ApiTokenService');
const { productAccess } = await import('./productAccess');
const { productAccessTools } = await import('@/services/agents/tools/productAccess');
const { checkLiveTools } = await import('@/services/agents/tools/checkLive');

const ORG = 'org_product_access';
const LOGIN = { signInUrl: 'https://app.northwind.example/sign-in', email: 'qa@northwind.example', password: 'a-long-qa-passphrase' };

beforeAll(async () => {
  const [envType] = await createObjectType({ slug: 'environment', label: 'Environment' }, ORG);
  const login = await storePlatformKey({ orgId: ORG, name: 'Northwind QA', platform: 'app-login', values: LOGIN });
  await db.insert(businessObjectSchema).values([
    { orgId: ORG, typeId: envType!.id, title: 'Northwind web (production)', metadata: { slug: 'northwind-web-production', product: 'northwind', stage: 'production', surface: 'web', url: 'https://app.northwind.example', qaLoginCredentialId: login.id, liveSetup: 'The QA account keeps no documents; a check uploads its own and deletes it.' } },
    { orgId: ORG, typeId: envType!.id, title: 'Northwind API (production)', metadata: { slug: 'northwind-api-production', product: 'northwind', stage: 'production', surface: 'api', url: 'https://api.northwind.example' } },
    { orgId: ORG, typeId: envType!.id, title: 'Kestrel web (production)', metadata: { slug: 'kestrel-web-production', product: 'kestrel', stage: 'production', surface: 'web', url: 'https://app.kestrel.example' } },
  ]);
});

afterAll(async () => {
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
});

describe('production access lives with the product (2026-09-30)', () => {
  it('reads a product\'s production URLs and its QA sign-in, without the password unless revealed', async () => {
    const access = await productAccess(ORG, 'northwind');

    expect(access.environments.map(e => e.slug).sort()).toEqual(['northwind-api-production', 'northwind-web-production']);

    const web = access.environments.find(e => e.surface === 'web')!;

    expect(web).toMatchObject({ url: 'https://app.northwind.example', login: { signInUrl: LOGIN.signInUrl, email: LOGIN.email, stored: true } });
    expect(web.login).not.toHaveProperty('password');
    // How QA prepares state on it, in the product's words.
    expect(web.liveSetup).toBe('The QA account keeps no documents; a check uploads its own and deletes it.');

    const revealed = await productAccess(ORG, 'northwind', { reveal: true });

    expect(revealed.environments.find(e => e.surface === 'web')!.login?.password).toBe(LOGIN.password);
  });

  it('is a granted tool that never returns the password', async () => {
    const ctx = { orgId: ORG, harnessConfig: { grantTools: ['product_access'] } } as never;
    const [tool] = productAccessTools(ctx);
    const out = String(await tool!.invoke({ product: 'northwind' }));

    expect(out).toContain(LOGIN.email);
    expect(out).not.toContain(LOGIN.password);
    expect(productAccessTools({ orgId: ORG, harnessConfig: {} } as never)).toEqual([]);
  });

  it('grants check_live only to a seat that names it', () => {
    expect(checkLiveTools({ orgId: ORG, harnessConfig: {} } as never)).toEqual([]);
    expect(checkLiveTools({ orgId: ORG, harnessConfig: { grantTools: ['check_live'] } } as never).map(t => t.name)).toEqual(['check_live']);
  });
});

describe('a QA sign-in found without an id in chat', () => {
  const FALLBACK_ORG = 'org_access_fallback';
  const OTHER_ORG = 'org_access_other';

  async function seedEnvironment(orgId: string) {
    const [envType] = await createObjectType({ slug: 'environment', label: 'Environment' }, orgId);
    await db.insert(businessObjectSchema).values({ orgId, typeId: envType!.id, title: 'Acme web (production)', metadata: { slug: 'acme-web-production', product: 'acme', stage: 'production', surface: 'web', url: 'https://app.acme.example' } });
  }

  it('uses the workspace\'s only live app login, never another workspace\'s, and ignores a revoked one', async () => {
    await seedEnvironment(FALLBACK_ORG);
    await seedEnvironment(OTHER_ORG);
    const revoked = await storePlatformKey({ orgId: FALLBACK_ORG, name: 'Old QA', platform: 'app-login', values: { ...LOGIN, email: 'old@acme.example' } });
    await db.update(apiTokenSchema).set({ revokedAt: new Date() }).where(eq(apiTokenSchema.id, revoked.id));
    await storePlatformKey({ orgId: OTHER_ORG, name: 'Other QA', platform: 'app-login', values: { ...LOGIN, email: 'other@elsewhere.example' } });
    await storePlatformKey({ orgId: OTHER_ORG, name: 'Other QA 2', platform: 'app-login', values: { ...LOGIN, email: 'other2@elsewhere.example' } });
    await storePlatformKey({ orgId: FALLBACK_ORG, name: 'Acme QA', platform: 'app-login', values: { ...LOGIN, email: 'qa@acme.example' } });

    const access = await productAccess(FALLBACK_ORG, 'acme');

    expect(access.environments[0]!.login).toMatchObject({ email: 'qa@acme.example', stored: true });
    expect(access.environments[0]!.login).not.toHaveProperty('password');
  });

  it('uses none when two are live, and says to name one', async () => {
    const access = await productAccess(OTHER_ORG, 'acme');

    expect(access.environments[0]!.login).toEqual({ signInUrl: null, email: null, stored: false, problem: '2 app logins are stored; name one on this environment.' });
  });
});
