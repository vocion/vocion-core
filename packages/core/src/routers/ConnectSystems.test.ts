/**
 * "Connect your systems" over RPC. What is held here: a key typed inline goes
 * to the vault through the Connectors page's one save and is never echoed —
 * not in the answer, not in an error, not in a log line, whatever the save
 * threw — and every call is scoped to the session's workspace, never to one
 * the caller names.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));
vi.mock('@/services/connect/createSourceWithCredential', () => ({ createSourceWithCredential: vi.fn() }));
vi.mock('@/services/connect/recommendations', () => ({ recommendConnections: vi.fn(async () => ({ candidates: [] })) }));
vi.mock('@/services/connect/verifyConnection', () => ({ verifyConnection: vi.fn(async () => ({ state: 'verified', preview: 'Found 3 documents', checks: [] })) }));
vi.mock('@/services/ConversationService', () => ({ getConversation: vi.fn() }));
vi.mock('@/services/connect/settleWalk', () => ({ settleConnectSystems: vi.fn(async () => ({ settled: true })) }));
vi.mock('@/libs/Logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { guardAuth } = await import('./AuthGuards');
const { createSourceWithCredential } = await import('@/services/connect/createSourceWithCredential');
const { recommendConnections } = await import('@/services/connect/recommendations');
const { verifyConnection } = await import('@/services/connect/verifyConnection');
const { getConversation } = await import('@/services/ConversationService');
const { settleConnectSystems } = await import('@/services/connect/settleWalk');
const { logger } = await import('@/libs/Logger');
const { finishConnectionsRoute, planConnectionsRoute, saveConnectionKeyRoute, verifyConnectionRoute } = await import('./ConnectSystems');

const ORG = 'proj-cs-northwind';
const SECRET = 'nw-e2e-not-a-real-key-7f3a9c';

function signedIn(orgId = ORG) {
  vi.mocked(guardAuth).mockResolvedValue({ userId: 'usr-cs-dana', orgId } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

function call(route: unknown, input: unknown): Promise<unknown> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<unknown> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

/** Everything the logger was handed, as one string. */
function logged(): string {
  return JSON.stringify([vi.mocked(logger.error).mock.calls, vi.mocked(logger.warn).mock.calls, vi.mocked(logger.info).mock.calls, vi.mocked(logger.debug).mock.calls]);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
});

describe('connectSystems.saveKey', () => {
  const input = { connector: 'sentry', config: { organization: 'northwind' }, values: { apiKey: SECRET } };

  it('saves through the Connectors page\'s one transaction, as the session\'s person in the session\'s workspace', async () => {
    vi.mocked(createSourceWithCredential).mockResolvedValue({ ok: true, sourceId: 41, slug: 'sentry' });

    const result = await call(saveConnectionKeyRoute, input);

    expect(createSourceWithCredential).toHaveBeenCalledWith({ orgId: ORG, actorUserId: 'usr-cs-dana', connector: 'sentry', config: { organization: 'northwind' }, credential: { values: { apiKey: SECRET } } });
    expect(result).toEqual({ ok: true, sourceId: 41 });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
  });

  it('never logs or echoes the key when the save throws something that quotes it', async () => {
    vi.mocked(createSourceWithCredential).mockRejectedValue(new Error(`duplicate key value (${SECRET}) violates constraint`));

    const error = await call(saveConnectionKeyRoute, input).catch((e: unknown) => e);

    expect(String((error as Error).message)).not.toContain(SECRET);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logged()).not.toContain(SECRET);
    expect(logged()).not.toContain('duplicate key');
  });

  it('passes the service\'s own refusal through, which names no secret', async () => {
    vi.mocked(createSourceWithCredential).mockResolvedValue({ ok: false, reason: 'That does not look like a valid Auth token.' });

    await expect(call(saveConnectionKeyRoute, input)).rejects.toMatchObject({ message: 'That does not look like a valid Auth token.' });
    expect(logged()).not.toContain(SECRET);
  });

  it('refuses a connector slug that is not a slug, before anything is saved', () => {
    const schema = (saveConnectionKeyRoute as unknown as { '~orpc': { inputSchema: { safeParse: (v: unknown) => { success: boolean } } } })['~orpc'].inputSchema;

    expect(schema.safeParse({ ...input, connector: '../vault' }).success).toBe(false);
  });
});

describe('tenant scoping', () => {
  it('plans and verifies in the session\'s workspace; the input cannot name another', async () => {
    signedIn('proj-cs-other');

    await call(planConnectionsRoute, { named: ['slack'], orgId: ORG });
    await call(verifyConnectionRoute, { connector: 'slack', orgId: ORG });

    expect(recommendConnections).toHaveBeenCalledWith({ orgId: 'proj-cs-other', userId: 'usr-cs-dana' }, { named: ['slack'], orgId: ORG });
    expect(vi.mocked(recommendConnections).mock.calls[0]![0].orgId).toBe('proj-cs-other');
    expect(verifyConnection).toHaveBeenCalledWith('proj-cs-other', 'slack');
  });

  it('writes the summary only onto a conversation this workspace and person can see', async () => {
    vi.mocked(getConversation).mockResolvedValue(null as never);

    await expect(call(finishConnectionsRoute, { conversationId: 7, decisionId: 31, summary: 'Connected Slack.' })).rejects.toBeTruthy();
    expect(getConversation).toHaveBeenCalledWith({ orgId: ORG, id: 7, viewerId: 'usr-cs-dana' });
    expect(settleConnectSystems).not.toHaveBeenCalled();
  });

  it('answers the walk\'s Decision with the summary as what happened, in the session\'s workspace', async () => {
    vi.mocked(getConversation).mockResolvedValue({ id: 7 } as never);

    await expect(call(finishConnectionsRoute, { conversationId: 7, decisionId: 31, summary: 'Connected Slack.' })).resolves.toEqual({ settled: true });
    expect(settleConnectSystems).toHaveBeenCalledWith({ orgId: ORG, userId: 'usr-cs-dana', conversationId: 7, decisionId: 31, summary: 'Connected Slack.' });
  });
});
