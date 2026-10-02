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

const { guardAuth } = await import('./AuthGuards');
const { createSourceOnLogin } = await import('@/services/connect/createSourceOnLogin');
const { saveSourceRoute } = await import('./Connect');

const ORG = 'org_connect_route';
const NOT_ADMIN = 'Only a workspace admin can connect a source';

/**
 * Point the mocked session at a person, the way a signed-in dashboard would.
 */
function signedIn() {
  vi.mocked(guardAuth).mockResolvedValue({ userId: 'usr-9', orgId: ORG } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

/**
 * Call the procedure's handler directly, with the input a client would send.
 * @param input - The payload.
 */
function call(input: unknown): Promise<unknown> {
  const procedure = saveSourceRoute as unknown as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<unknown> } };
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
