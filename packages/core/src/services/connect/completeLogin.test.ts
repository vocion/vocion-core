/**
 * What happens after a vendor says yes (#1080), against PGlite: the grant is a
 * login row in the credential store, the connector's sources are linked to it,
 * and a chat card is approved by the person who logged in. The rules someone
 * could get wrong: a pasted key the person chose survives, a failed login is
 * not a rejection, and nothing is half written.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/connect/attempts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/libs/connect/attempts')>();
  return { ...original, recordConnectAttempt: vi.fn(original.recordConnectAttempt) };
});

const { db } = await import('@/libs/DB');
const { apiTokenSchema, conversationMessageSchema, conversationSchema, knowledgeSourceSchema, sourceAuditSchema, sourceCredentialSchema, sourceDekSchema } = await import('@/models/Schema');
const { storePlatformKey } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { completeLogin, recordFailedLogin } = await import('./completeLogin');
const { lastConnectAttempts, recordConnectAttempt } = await import('@/libs/connect/attempts');

const ORG = 'org_login';
const USER = 'user_admin';
const GITHUB_PAT = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

function stubProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'github',
    connectorSlugs: ['github'],
    label: 'GitHub',
    requiredEnv: [],
    configured: () => true,
    authorizeUrl: () => 'https://github.example',
    exchange: async () => ({ ok: false as const, reason: 'unused' }),
    summarize: () => ({ account: 'northwind (organization)' }),
    ...overrides,
  } as never;
}

const exchanged = { credentials: { installationId: '42' }, displayName: 'GitHub - northwind' };

async function seedSource(slug: string, connector: string, apiTokenId: string | null = null) {
  const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug, kind: 'plugin', configJson: { _connector: connector }, apiTokenId }).returning();
  return row!;
}

async function sourceLink(id: number) {
  const [row] = await db.select({ apiTokenId: knowledgeSourceSchema.apiTokenId }).from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, id));
  return row!.apiTokenId;
}

async function seedCard() {
  const [conversation] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'lead', title: 'Connect tools' }).returning();
  const [message] = await db.insert(conversationMessageSchema).values({
    conversationId: conversation!.id,
    role: 'assistant',
    content: '',
    runsJson: [{ type: 'card', id: 'card_1', kind: 'link', label: 'Connect GitHub', actionId: '', state: 'proposed', href: '/x' }],
  }).returning();
  return { conversationId: conversation!.id, messageId: message!.id };
}

async function cardRun(messageId: number) {
  const [row] = await db.select({ runs: conversationMessageSchema.runsJson }).from(conversationMessageSchema).where(eq(conversationMessageSchema.id, messageId));
  return row!.runs![0] as Record<string, any>;
}

async function loginRows() {
  return db.select().from(apiTokenSchema).where(and(eq(apiTokenSchema.orgId, ORG), eq(apiTokenSchema.obtainedVia, 'login')));
}

afterEach(async () => {
  await db.delete(conversationSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
  await db.delete(sourceAuditSchema);
});

describe('completeLogin', () => {
  it('stores the grant as a login row with no source existing, and writes no source_credential', async () => {
    const outcome = await completeLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', exchanged });

    expect(outcome).toMatchObject({ ok: true, linkedSourceIds: [] });

    const rows = await loginRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: 'github', obtainedVia: 'login', account: 'northwind (organization)', name: 'GitHub - northwind' });
    expect(await db.select().from(sourceCredentialSchema)).toHaveLength(0);
    expect((await lastConnectAttempts(ORG)).get('github')).toMatchObject({ ok: true });
  });

  it('links an unlinked source and relinks one on the pasted row this login replaces', async () => {
    const pasted = await storePlatformKey({ orgId: ORG, platform: 'github', name: 'old pat', apiKey: GITHUB_PAT, createdBy: USER });
    const unlinked = await seedSource('github-a', 'github');
    const onPasted = await seedSource('github-b', 'github', pasted.id);

    const outcome = await completeLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', exchanged });

    expect(outcome.ok).toBe(true);

    const [login] = await loginRows();

    expect(await sourceLink(unlinked.id)).toBe(login!.id);
    expect(await sourceLink(onPasted.id)).toBe(login!.id);
  });

  it('links the source the login started from, whatever it held before', async () => {
    const named = await seedSource('github-n', 'github');

    const outcome = await completeLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', sourceSlug: 'github-n', exchanged });

    expect(outcome.ok && outcome.linkedSourceIds).toEqual([named.id]);
  });

  it('leaves a source on a pasted Jira row the person chose when another account logs in', async () => {
    const pasted = await storePlatformKey({ orgId: ORG, platform: 'jira', name: 'Jira key', values: { email: 'dev@northwind.example', apiToken: 'jira-api-token-1234567890' }, createdBy: USER });
    const chosen = await seedSource('jira-a', 'jira', pasted.id);
    const bare = await seedSource('jira-b', 'jira');
    const atlassian = stubProvider({ id: 'atlassian', connectorSlugs: ['jira'], label: 'Atlassian', summarize: () => ({ account: 'northwind.atlassian.net' }) });

    const outcome = await completeLogin({ orgId: ORG, userId: USER, provider: atlassian, connectorSlug: 'jira', exchanged: { credentials: { accessToken: 'at' }, displayName: 'Jira - northwind' } });

    expect(outcome.ok).toBe(true);

    const [login] = await loginRows();

    expect(await sourceLink(chosen.id)).toBe(pasted.id);
    expect(await sourceLink(bare.id)).toBe(login!.id);
  });

  it('serves every source of the connector from one login, even on a platform whose pasted keys are not shared', async () => {
    const first = await seedSource('jira-a', 'jira');
    const second = await seedSource('jira-b', 'jira');
    const atlassian = stubProvider({ id: 'atlassian', connectorSlugs: ['jira'], label: 'Atlassian', summarize: () => ({ account: 'northwind.atlassian.net' }) });

    await completeLogin({ orgId: ORG, userId: USER, provider: atlassian, connectorSlug: 'jira', exchanged: { credentials: { accessToken: 'at-1' }, displayName: 'Jira - northwind' } });

    const [login] = await loginRows();

    expect(await sourceLink(first.id)).toBe(login!.id);
    expect(await sourceLink(second.id)).toBe(login!.id);
    expect(await getCredentialsForConnector({ orgId: ORG, connectorSlug: 'jira', apiTokenId: await sourceLink(second.id) })).toEqual({ accessToken: 'at-1' });
  });

  it('marks the card approved by the person who logged in', async () => {
    const { conversationId, messageId } = await seedCard();

    await completeLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', exchanged, card: { conversationId, cardId: 'card_1' } });

    const run = await cardRun(messageId);

    expect(run.state).toBe('decided');
    expect(run.decision).toMatchObject({ action: 'approve', by: USER });
  });

  it('still succeeds when the card was already decided', async () => {
    const { conversationId, messageId } = await seedCard();
    await db.update(conversationMessageSchema).set({ runsJson: [{ type: 'card', id: 'card_1', kind: 'link', label: 'x', actionId: '', state: 'decided', href: '/x' }] as never }).where(eq(conversationMessageSchema.id, messageId));

    const outcome = await completeLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', exchanged, card: { conversationId, cardId: 'card_1' } });

    expect(outcome.ok).toBe(true);
    expect(await loginRows()).toHaveLength(1);
  });

  it('refuses a connector with no credential platform and stores nothing', async () => {
    const outcome = await completeLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'no-such-connector', exchanged });

    expect(outcome).toEqual({ ok: false, reason: 'no_credential_platform' });
    expect(await loginRows()).toHaveLength(0);
  });

  it('writes no login row when a later step in the same login throws', async () => {
    await seedSource('github-a', 'github');
    vi.mocked(recordConnectAttempt).mockRejectedValueOnce(new Error('audit table gone'));

    await expect(completeLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', exchanged })).rejects.toThrow('audit table gone');

    expect(await loginRows()).toHaveLength(0);
  });
});

describe('recordFailedLogin', () => {
  it('records the attempt and notes it on the card, but never rejects the card', async () => {
    const { conversationId, messageId } = await seedCard();

    await recordFailedLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', reason: 'access_denied', card: { conversationId, cardId: 'card_1' } });

    const run = await cardRun(messageId);

    expect(run.state).toBe('proposed');
    expect(run.lastAttempt.summary).toBe('GitHub denied access');
    expect((await lastConnectAttempts(ORG)).get('github')).toMatchObject({ ok: false, reason: 'access_denied' });
  });

  it('drops a failure that arrives after the same login succeeded, so the newest attempt stays the success', async () => {
    const stateIssuedAt = new Date(Date.now() - 60_000);
    await completeLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', exchanged });

    // The back button replays the callback: the vendor code is spent, the exchange refuses.
    await recordFailedLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', reason: 'code_refused', stateIssuedAt });

    expect((await lastConnectAttempts(ORG)).get('github')).toMatchObject({ ok: true });
  });

  it('still records a failure from a login started after the last success', async () => {
    await completeLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', exchanged });

    await recordFailedLogin({ orgId: ORG, userId: USER, provider: stubProvider(), connectorSlug: 'github', reason: 'access_denied', stateIssuedAt: new Date(Date.now() + 60_000) });

    expect((await lastConnectAttempts(ORG)).get('github')).toMatchObject({ ok: false, reason: 'access_denied' });
  });
});
