/**
 * The admin gate and the expiry validation on the token routes.
 *
 * Issuing a token is a privilege escalation — a token acts with the `owner`
 * workspace role — so "members are refused" is the load-bearing assertion here,
 * not a nicety. `guardAuth` is mocked because the session itself is not what is
 * under test; what the routes do with the role it reports is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// A factory, not an automock: automocking still loads the real module for its
// shape, and AuthGuards pulls in next-auth, which does not import cleanly in
// the unit environment.
vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { apiTokenSchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { sourceDekSchema } = await import('@/models/Schema');
const { createPlatformKeyRoute, createTokenRoute, listPlatformsRoute, listTokensRoute, revokeTokenRoute } = await import('./ApiTokens');
const { issueToken } = await import('@/services/ApiTokenService');

const ORG = 'org_router_test';

/**
 * Point the mocked session at a role, the way a signed-in dashboard would.
 * @param role - The membership role the session reports.
 */
function signedInAs(role: 'admin' | 'member') {
  vi.mocked(guardAuth).mockResolvedValue({
    userId: 'usr-1',
    orgId: ORG,
    accountId: 'acct-1',
    projectId: ORG,
    role,
    has: ({ role: required }: { role: string }) =>
      required === 'org:admin' ? role === 'admin' : true,
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

/**
 * Call an oRPC procedure directly, bypassing the HTTP layer. A procedure keeps
 * its implementation on the `~orpc` definition, so the test invokes that with
 * the input the client would have sent.
 * @param route - The exported procedure.
 * @param input - The validated input payload.
 */
function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(apiTokenSchema);
});

describe('apiTokens routes', () => {
  it('lets an admin create a token and returns the plaintext once', async () => {
    signedInAs('admin');
    const created = await call(createTokenRoute, { name: 'panel', expiresAt: null });

    expect((created as any).token).toMatch(/^vcn_live_/);

    const listed = await call(listTokensRoute, undefined);

    expect((listed as any[]).map(t => t.name)).toEqual(['panel']);
    // The list carries metadata only — no secret, no hash.
    expect(JSON.stringify(listed)).not.toContain((created as any).token);
  });

  it('refuses a member on every route', async () => {
    signedInAs('member');

    await expect(call(listTokensRoute, undefined)).rejects.toThrow(/forbidden/i);
    await expect(call(createTokenRoute, { name: 'nope', expiresAt: null })).rejects.toThrow(/forbidden/i);
    await expect(call(revokeTokenRoute, { tokenId: 'whatever' })).rejects.toThrow(/forbidden/i);

    // Nothing was written on the way to being refused.
    expect(await db.select().from(apiTokenSchema)).toHaveLength(0);
  });

  it('rejects an expiry that is already in the past', async () => {
    signedInAs('admin');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await expect(call(createTokenRoute, { name: 'stale', expiresAt: yesterday }))
      .rejects
      .toThrow(/future/i);
  });

  it('rejects an expiry further out than ten years', async () => {
    signedInAs('admin');
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 11);

    await expect(call(createTokenRoute, { name: 'forever-ish', expiresAt: farFuture.toISOString() }))
      .rejects
      .toThrow(/10 years/);
  });

  it('rejects an unparseable expiry', async () => {
    signedInAs('admin');

    await expect(call(createTokenRoute, { name: 'bad', expiresAt: 'not-a-date' }))
      .rejects
      .toThrow(/valid date/i);
  });

  it('stores the requested expiry', async () => {
    signedInAs('admin');
    const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await call(createTokenRoute, { name: 'dated', expiresAt: inAWeek.toISOString() });
    const [row] = (await call(listTokensRoute, undefined)) as any[];

    expect(row.expiresAt?.getTime()).toBe(inAWeek.getTime());
  });

  it('revokes only within the caller org', async () => {
    signedInAs('admin');
    const mine = await issueToken({ orgId: ORG, name: 'mine' });
    const theirs = await issueToken({ orgId: 'org_other', name: 'theirs' });

    // Another tenant's id is accepted as input but changes nothing, because
    // the service scopes the update by orgId.
    await call(revokeTokenRoute, { tokenId: theirs.id });
    await call(revokeTokenRoute, { tokenId: mine.id });

    const rows = (await call(listTokensRoute, undefined)) as any[];

    expect(rows.find(r => r.id === mine.id).revokedAt).not.toBeNull();

    const { verifyToken } = await import('@/services/ApiTokenService');

    expect(await verifyToken(theirs.token)).not.toBeNull();
  });
});

/**
 * Platform-key routes. Storing an OpenAI key is the same privilege escalation
 * as minting a Vocion token — arguably worse, since it redirects where a
 * workspace's model spend lands — so the admin gate matters just as much here.
 */
describe('platform key routes', () => {
  const OPENAI_KEY = 'sk-abcdefghijklmnop1234';

  beforeEach(async () => {
    await db.delete(apiTokenSchema);
    await db.delete(sourceDekSchema);
  });

  it('offers the platform list to any signed-in member', async () => {
    signedInAs('member');
    const options = await call<Array<{ id: string; keySource: string; fields: Array<{ name: string }> }>>(listPlatformsRoute, undefined);

    expect(options.map(option => option.id)).toContain('openai');
    expect(options.find(option => option.id === 'vocion')?.keySource).toBe('minted');
  });

  it('describes each platform fields so the form does not hardcode them', async () => {
    signedInAs('member');
    const options = await call<Array<{ id: string; keySource: string; fields: Array<{ name: string }> }>>(listPlatformsRoute, undefined);
    const aws = options.find(option => option.id === 'aws');

    expect(aws?.fields.map(field => field.name)).toEqual(['accessKeyId', 'secretAccessKey']);
  });

  it('stores a key for an admin and returns only the masked hint', async () => {
    signedInAs('admin');
    const saved = await call<{ keyHint: string }>(createPlatformKeyRoute, {
      name: 'Acme OpenAI',
      platform: 'openai',
      values: { apiKey: OPENAI_KEY },
      expiresAt: null,
    });

    expect(saved.keyHint).toBe('…1234');
    expect(JSON.stringify(saved)).not.toContain(OPENAI_KEY);
  });

  it('refuses a member', async () => {
    signedInAs('member');

    await expect(call(createPlatformKeyRoute, {
      name: 'Acme OpenAI',
      platform: 'openai',
      values: { apiKey: OPENAI_KEY },
      expiresAt: null,
    })).rejects.toThrow();

    expect(await db.select().from(apiTokenSchema)).toHaveLength(0);
  });

  it('passes the shape complaint back to the person pasting', async () => {
    signedInAs('admin');

    await expect(call(createPlatformKeyRoute, {
      name: 'Acme OpenAI',
      platform: 'openai',
      values: { apiKey: 'nonsense' },
      expiresAt: null,
    })).rejects.toThrow(/does not look like a valid OpenAI key/);
  });

  it('rejects an unknown platform at the input boundary', async () => {
    signedInAs('admin');

    await expect(call(createPlatformKeyRoute, {
      name: 'Mystery',
      platform: 'mystery-llm',
      values: { apiKey: 'anything' },
      expiresAt: null,
    })).rejects.toThrow();
  });

  it('applies the same expiry rules as a minted token', async () => {
    signedInAs('admin');

    await expect(call(createPlatformKeyRoute, {
      name: 'Acme OpenAI',
      platform: 'openai',
      values: { apiKey: OPENAI_KEY },
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })).rejects.toThrow(/future/);
  });
});
