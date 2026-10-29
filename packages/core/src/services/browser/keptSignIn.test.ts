/**
 * A kept sign-in on a connector, against PGlite: sealed under the workspace's
 * key and opened again for a run, refused for another site's cookies, marked
 * when a run finds it expired, and saved back from a run's browser with only
 * the connector's domains. Every site and value is fictional.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { acceptSignIn, keepSignInAfterRun, keptSignInStatuses, markSignInNeeded, openKeptSignIn, SignInRefusedError } = await import('./keptSignIn');

const ORG = 'org_kept_sign_in';
const OTHER_ORG = 'org_kept_sign_in_other';
const SECRET_VALUE = 'fixture-session-value-0042';

function cookie(domain: string, name: string, value = SECRET_VALUE) {
  return { name, value, domain, path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const };
}

const STATE = {
  cookies: [cookie('login.squarespace.com', 'crumb'), cookie('.squarespace.com', 'member'), cookie('example-site.squarespace.com', 'site')],
  origins: [{ origin: 'https://example-site.squarespace.com', localStorage: [{ name: 'editor.seen', value: 'true' }] }],
};

let squarespaceId = 0;
let webId = 0;

beforeEach(async () => {
  await db.delete(knowledgeSourceSchema);
  const [sq] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'squarespace', configJson: { _connector: 'squarespace', siteUrl: 'https://example-site.squarespace.com' } }).returning();
  const [web] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'web', kind: 'web', configJson: { urls: ['https://northwind-home.example'] } }).returning();
  squarespaceId = sq!.id;
  webId = web!.id;
});

describe('a kept sign-in', () => {
  it('is sealed: the row holds ciphertext, never a cookie, and opens again for a run', async () => {
    const kept = await acceptSignIn({ orgId: ORG, sourceId: squarespaceId, raw: STATE, savedFrom: 'the operator CLI on a laptop', savedBy: 'token:t1' });

    expect(kept).toMatchObject({ kept: true, cookies: 3, savedFrom: 'the operator CLI on a laptop', site: 'https://example-site.squarespace.com', needsSignIn: null });

    const [row] = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, squarespaceId));

    expect(JSON.stringify(row!.keptSignIn)).not.toContain(SECRET_VALUE);
    expect(row!.keptSignIn?.sealed?.ciphertext).toBeTruthy();

    const opened = await openKeptSignIn(ORG, squarespaceId);

    expect(opened?.state.cookies.map(c => c.name)).toEqual(['crumb', 'member', 'site']);
    expect(opened?.state.cookies[0]!.value).toBe(SECRET_VALUE);
    expect(opened?.state.origins).toEqual(STATE.origins);
  });

  it('is not opened under another workspace', async () => {
    await acceptSignIn({ orgId: ORG, sourceId: squarespaceId, raw: STATE, savedFrom: 'x', savedBy: null });

    await expect(openKeptSignIn(OTHER_ORG, squarespaceId)).resolves.toBeNull();
  });

  it('is refused for a cookie of another site, and for a connector that keeps none', async () => {
    await expect(acceptSignIn({ orgId: ORG, sourceId: squarespaceId, raw: { cookies: [...STATE.cookies, cookie('.northwind-home.example', 'x')] }, savedFrom: 'x', savedBy: null })).rejects.toBeInstanceOf(SignInRefusedError);
    await expect(acceptSignIn({ orgId: ORG, sourceId: webId, raw: STATE, savedFrom: 'x', savedBy: null })).rejects.toThrow('does not keep a sign-in');
    await expect(openKeptSignIn(ORG, squarespaceId)).resolves.toBeNull();
  });

  it('is marked when a run finds it expired, and a fresh one clears the mark', async () => {
    await acceptSignIn({ orgId: ORG, sourceId: squarespaceId, raw: STATE, savedFrom: 'x', savedBy: null });
    await markSignInNeeded(ORG, squarespaceId, 'Squarespace showed its sign-in page.');

    expect((await keptSignInStatuses(ORG))[squarespaceId]).toMatchObject({ kept: true, needsSignIn: { why: 'Squarespace showed its sign-in page.' } });
    expect((await keptSignInStatuses(ORG))[webId]).toBeUndefined();

    await acceptSignIn({ orgId: ORG, sourceId: squarespaceId, raw: STATE, savedFrom: 'a session file', savedBy: null });

    expect((await keptSignInStatuses(ORG))[squarespaceId]?.needsSignIn).toBeNull();
  });

  it('is saved back from a run\'s browser, refreshed, with only the connector\'s domains', async () => {
    await acceptSignIn({ orgId: ORG, sourceId: squarespaceId, raw: STATE, savedFrom: 'x', savedBy: null });
    const browser = { context: { storageState: async () => ({
      cookies: [cookie('.squarespace.com', 'member', 'refreshed-value'), cookie('.northwind-home.example', 'elsewhere')],
      origins: [{ origin: 'https://northwind-home.example', localStorage: [{ name: 'a', value: 'b' }] }],
    }) } };

    const saved = await keepSignInAfterRun({ orgId: ORG, signIn: { sourceId: squarespaceId, vendor: 'Squarespace', domains: ['squarespace.com'] }, browser, runLabel: 'Browser run 7' });

    expect(saved).toBe(true);

    const opened = await openKeptSignIn(ORG, squarespaceId);

    expect(opened?.state.cookies).toEqual([cookie('.squarespace.com', 'member', 'refreshed-value')]);
    expect(opened?.state.origins).toEqual([]);
    expect(opened?.savedFrom).toBe('Browser run 7, refreshed as it ended');
  });

  it('is not overwritten by a browser holding no cookie of its site', async () => {
    await acceptSignIn({ orgId: ORG, sourceId: squarespaceId, raw: STATE, savedFrom: 'the operator CLI', savedBy: null });
    const browser = { context: { storageState: async () => ({ cookies: [cookie('.northwind-home.example', 'elsewhere')], origins: [] }) } };

    await expect(keepSignInAfterRun({ orgId: ORG, signIn: { sourceId: squarespaceId, vendor: 'Squarespace', domains: ['squarespace.com'] }, browser, runLabel: 'Browser run 8' })).resolves.toBe(false);
    expect((await openKeptSignIn(ORG, squarespaceId))?.savedFrom).toBe('the operator CLI');
  });
});
