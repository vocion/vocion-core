/**
 * What the ledger says, and why the agent and the Sources page can no longer
 * disagree about it.
 *
 * The states matter individually: "connect HubSpot" is the wrong sentence for
 * a member who is not allowed to, and for a grant somebody revoked last
 * Tuesday. Each case below is one of those sentences.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const {
  apiTokenSchema,
  projectSchema,
  sourceCredentialSchema,
  sourceDekSchema,
  sourceInstallSchema,
  tenantAccountSchema,
} = await import('@/models/Schema');
const { capabilityLedger } = await import('./capabilityLedger');
const { ensureInstall } = await import('@/services/SourceCredentialService');

const ORG = 'org_ledger_test';
const JAMIE = { kind: 'user' as const, id: 'user_jamie' };
const DANA = { kind: 'user' as const, id: 'user_dana' };
const SYSTEM = { kind: 'system' as const };
let dekId = 0;

/**
 * A live grant on an install, owned by `userId` (null = the workspace's).
 * @param slug
 * @param userId
 */
async function grant(slug: string, userId: string | null) {
  const installId = await ensureInstall(ORG, slug, null, ORG);
  await db.insert(sourceCredentialSchema).values({
    installId,
    userId,
    displayName: userId ?? 'workspace',
    dekId,
    ciphertext: 'x',
    nonce: 'y',
    authTag: 'z',
  });
}

beforeEach(async () => {
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  const [dek] = await db
    .insert(sourceDekSchema)
    .values({ orgId: ORG, wrappedDek: 'test', algorithm: 'AES_256_GCM' })
    .returning({ id: sourceDekSchema.id });
  dekId = dek!.id;
  await db.insert(tenantAccountSchema).values({ id: ORG, name: 'Ledger Test', slug: 'ledger-test' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ORG, slug: 'ledger-test', name: 'Ledger Test' });
});

afterAll(async () => {
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('capabilityLedger', () => {
  it('offers a personal connector to the person, and only their own grant counts', async () => {
    await grant('gmail', JAMIE.id);

    const mine = await capabilityLedger(ORG, { actor: JAMIE });
    const theirs = await capabilityLedger(ORG, { actor: DANA });

    expect(mine.get('gmail')?.state).toEqual({ kind: 'ready' });
    // Dana connected nothing, so she is offered the connection rather than
    // handed Jamie's mailbox.
    expect(theirs.get('gmail')?.state).toEqual({ kind: 'connectable', scope: 'user', authKind: 'oauth' });
  });

  it('offers a workspace grant as a second line rather than silently using it', async () => {
    await grant('gmail', null);
    await grant('gmail', JAMIE.id);

    const mine = await capabilityLedger(ORG, { actor: JAMIE });
    const theirs = await capabilityLedger(ORG, { actor: DANA });

    // Jamie has his own, so there is nothing to offer him.
    expect(mine.get('gmail')?.workspaceGrantAvailable).toBe(false);
    // Dana can use the workspace one — she is told, not switched over.
    expect(theirs.get('gmail')?.state).toEqual({ kind: 'ready' });
    expect(theirs.get('gmail')?.workspaceGrantAvailable).toBe(true);
  });

  it('has nothing personal to offer a run with no person in it', async () => {
    const ledger = await capabilityLedger(ORG, { actor: SYSTEM });

    // Not `connectable`: a schedule cannot connect anybody's mailbox, and a
    // card nobody can act on is worse than no card.
    expect(ledger.get('gmail')?.state).toEqual({ kind: 'unavailable' });
  });

  it('tells a member who connects a workspace-tier source, rather than offering them the button', async () => {
    const member = await capabilityLedger(ORG, { actor: JAMIE, role: 'org:member' });
    const admin = await capabilityLedger(ORG, { actor: JAMIE, role: 'org:admin' });

    // A shared HubSpot token is a company asset; one tap by whoever happened
    // to be in a chat is the wrong way to bind one.
    expect(member.get('hubspot')?.state).toEqual({ kind: 'needs-admin' });
    expect(admin.get('hubspot')?.state).toEqual({ kind: 'connectable', scope: 'workspace', authKind: 'apikey' });
  });

  it('reads a stored platform key as connected, for everybody', async () => {
    await db.insert(apiTokenSchema).values({
      id: 'tok_hubspot_1',
      orgId: ORG,
      name: 'HubSpot',
      platform: 'hubspot',
      dekId,
      ciphertext: 'x',
      nonce: 'y',
      authTag: 'z',
      keyHint: '…abcd',
    });

    const member = await capabilityLedger(ORG, { actor: DANA, role: 'org:member' });

    // One credential speaks for the workspace, so a member reads it as ready
    // — the agent and the Sources page cannot disagree about that.
    expect(member.get('hubspot')?.state).toEqual({ kind: 'ready' });
  });

  it('says a connector needing no credential is ready', async () => {
    const ledger = await capabilityLedger(ORG, { actor: SYSTEM });

    expect(ledger.get('web')?.state).toEqual({ kind: 'ready' });
  });

  it('settles `either` to personal, so the first connection grants one person', async () => {
    const ledger = await capabilityLedger(ORG, { actor: JAMIE, role: 'org:member' });

    expect(ledger.get('slack')?.identity).toBe('personal');
    expect(ledger.get('slack')?.state).toEqual({ kind: 'connectable', scope: 'user', authKind: 'oauth' });
  });
});
