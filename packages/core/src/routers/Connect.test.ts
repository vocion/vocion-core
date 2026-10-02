/**
 * The save route behind the Connectors page's login form (#1080). The admin
 * check and the credential link live in `createSourceOnLogin`; what is held
 * here is that the route hands it the session's person and workspace, returns
 * its success, and turns its refusal into a sentence the form can show.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));
vi.mock('@/services/connect/createSourceOnLogin', () => ({
  createSourceOnLogin: vi.fn(),
}));
vi.mock('@/services/connect/createSourceWithCredential', () => ({
  createSourceWithCredential: vi.fn(),
}));
vi.mock('@/services/connect/revealStoredCredential', () => ({
  revealStoredCredential: vi.fn(),
}));

const { guardAuth } = await import('./AuthGuards');
const { createSourceOnLogin } = await import('@/services/connect/createSourceOnLogin');
const { createSourceWithCredential } = await import('@/services/connect/createSourceWithCredential');
const { revealStoredCredential } = await import('@/services/connect/revealStoredCredential');
const { saveSourceRoute, addConnectorRoute, revealStoredCredentialRoute } = await import('./Connect');

const ORG = 'org_connect_route';
const NOT_ADMIN = 'Only a workspace admin can connect a source';

/**
 * Point the mocked session at a person, the way a signed-in dashboard would.
 * @param role
 */
function signedIn(role: 'admin' | 'member' = 'admin') {
  vi.mocked(guardAuth).mockResolvedValue({ userId: 'usr-9', orgId: ORG, has: ({ role: required }: { role: string }) => required === 'org:member' || role === 'admin' } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

/**
 * Call the procedure's handler directly, with the input a client would send.
 * @param input - The payload.
 * @param route
 */
function call(input: unknown, route: unknown = saveSourceRoute): Promise<unknown> {
  const procedure = route as unknown as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<unknown> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

/**
 * Run the payload through the procedure's input schema first, as the HTTP
 * layer does, so schema defaults (createNew) apply.
 * @param input - The payload a client would send.
 */
function parseInput(input: unknown): unknown {
  const procedure = saveSourceRoute as unknown as { '~orpc': { inputSchema: { parse: (value: unknown) => unknown } } };
  return procedure['~orpc'].inputSchema.parse(input);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
});

describe('connect.saveSource', () => {
  it('saves, always as a new source, for the signed-in person in their workspace and returns the new source id', async () => {
    vi.mocked(createSourceOnLogin).mockResolvedValue({ ok: true, sourceId: 42, slug: 'github', created: true });
    const result = await call(parseInput({ connector: 'github', config: { repos: ['northwind/portal'] } }));

    expect(result).toEqual({ ok: true, sourceId: 42 });
    expect(createSourceOnLogin).toHaveBeenCalledWith({
      orgId: ORG,
      actorUserId: 'usr-9',
      connector: 'github',
      config: { repos: ['northwind/portal'] },
      sourceSlug: undefined,
      createNew: true,
    });
  });

  it('shows a member the refusal sentence, not a generic error', async () => {
    vi.mocked(createSourceOnLogin).mockResolvedValue({ ok: false, reason: NOT_ADMIN });

    await expect(call(parseInput({ connector: 'github', config: {} }))).rejects.toMatchObject({ code: 'bad-request', message: NOT_ADMIN });
  });

  it('surfaces the service reason as the error message', async () => {
    vi.mocked(createSourceOnLogin).mockResolvedValue({ ok: false, reason: 'Log in to GitHub first' });

    await expect(call(parseInput({ connector: 'github', config: {} }))).rejects.toMatchObject({ message: 'Log in to GitHub first' });
  });
});

describe('connect.addConnector', () => {
  const pasted = { connector: 'hubspot', config: {}, credential: { values: { token: 'pat-na1-route-test' } } };

  it('hands the signed-in person, workspace and the pasted values to the one-step save and returns the source id', async () => {
    vi.mocked(createSourceWithCredential).mockResolvedValue({ ok: true, sourceId: 8, slug: 'hubspot' });
    const result = await call(pasted, addConnectorRoute);

    expect(result).toEqual({ ok: true, sourceId: 8 });
    expect(createSourceWithCredential).toHaveBeenCalledWith({ orgId: ORG, actorUserId: 'usr-9', ...pasted });
  });

  it('shows the refusal sentence inline for a member, or for a credential write that failed', async () => {
    vi.mocked(createSourceWithCredential).mockResolvedValue({ ok: false, reason: NOT_ADMIN });

    await expect(call(pasted, addConnectorRoute)).rejects.toMatchObject({ code: 'bad-request', message: NOT_ADMIN });
  });

  it('accepts a kept stored credential and rejects a body with neither choice', async () => {
    const procedure = addConnectorRoute as unknown as { '~orpc': { inputSchema: { safeParse: (value: unknown) => { success: boolean } } } };
    const schema = procedure['~orpc'].inputSchema;

    expect(schema.safeParse({ connector: 'github', config: {}, credential: { keepStored: true } }).success).toBe(true);
    expect(schema.safeParse({ connector: 'github', config: {} }).success).toBe(false);
  });
});

describe('connect.revealStoredCredential', () => {
  it('a member is refused with 403 and the credential is never opened', async () => {
    signedIn('member');

    await expect(call({ connector: 'hubspot' }, revealStoredCredentialRoute)).rejects.toMatchObject({ status: 403 });
    expect(revealStoredCredential).not.toHaveBeenCalled();
  });

  it('an admin gets the stored value, asked for as themselves in their workspace', async () => {
    vi.mocked(revealStoredCredential).mockResolvedValue({ status: 'ok', values: { token: 'pat-na1-route-test' } });
    const result = await call({ connector: 'hubspot' }, revealStoredCredentialRoute);

    expect(result).toEqual({ status: 'ok', values: { token: 'pat-na1-route-test' } });
    expect(revealStoredCredential).toHaveBeenCalledWith({ orgId: ORG, userId: 'usr-9', connector: 'hubspot' });
  });

  it('a failure to open the credential says nothing about why, beyond a sentence', async () => {
    vi.mocked(revealStoredCredential).mockRejectedValue(new Error('kms: arn:aws:kms:secret-detail'));

    await expect(call({ connector: 'hubspot' }, revealStoredCredentialRoute)).rejects.toMatchObject({ message: 'Could not read the stored credential.' });
  });
});
