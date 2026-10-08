/**
 * Reset a plugin's setup: the connectors it names are disconnected, the
 * records of the types it names are deleted with their artifacts, and the
 * proposals still waiting to create one are rejected — nothing else. Against
 * the in-memory database, with the software factory's own declaration
 * (connectors: github; records: product, repo).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { and, eq } = await import('drizzle-orm');
const { actionRunSchema, artifactSchema, businessObjectSchema, businessObjectTypeSchema, sourceCredentialSchema, sourceDekSchema, sourceInstallSchema } = await import('@/models/Schema');
const { createArtifact } = await import('@/services/ArtifactService');
const { resetSetup } = await import('./setupReset');

const ORG = 'org_setup_reset';
const OTHER = 'org_setup_other';

async function seed(orgId: string) {
  const [repoType] = await db.insert(businessObjectTypeSchema).values({ orgId, slug: 'repo', label: 'Repository', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
  const [reqType] = await db.insert(businessObjectTypeSchema).values({ orgId, slug: 'request', label: 'Request', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
  const [repo] = await db.insert(businessObjectSchema).values({ orgId, typeId: repoType!.id, title: 'northwind/send-api', metadata: { slug: 'northwind-send-api' } } as never).returning({ id: businessObjectSchema.id });
  const [request] = await db.insert(businessObjectSchema).values({ orgId, typeId: reqType!.id, title: 'A request that stays', metadata: {} } as never).returning({ id: businessObjectSchema.id });
  await createArtifact({ orgId, kind: 'markdown', title: 'send-api — map', spec: { md: '# send-api' }, record: { type: 'object', id: String(repo!.id), role: 'architecture-summary' }, author: { kind: 'agent', id: 'agent:release' } } as never);
  const [install] = await db.insert(sourceInstallSchema).values({ orgId, sourceSlug: 'github', installedBy: 'usr-jamie' } as never).returning({ id: sourceInstallSchema.id });
  const [dek] = await db.insert(sourceDekSchema).values({ orgId, wrappedDek: 'wrapped' } as never).returning({ id: sourceDekSchema.id });
  await db.insert(sourceCredentialSchema).values({ installId: install!.id, displayName: 'GitHub (seeded)', dekId: dek!.id, ciphertext: 'c', nonce: 'n', authTag: 't' } as never);
  await db.insert(actionRunSchema).values({ orgId, actionId: 'objects.propose_candidate', input: { objectType: 'repo', title: 'northwind/send-web', dedupOn: ['slug'] }, status: 'pending' } as never);
  await db.insert(actionRunSchema).values({ orgId, actionId: 'objects.propose_candidate', input: { objectType: 'request', title: 'stays pending' }, status: 'pending' } as never);
  return { repoId: repo!.id, requestId: request!.id, installId: install!.id };
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(artifactSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  await db.delete(sourceDekSchema);
});

describe('resetSetup', () => {
  it('disconnects the setup connectors, deletes the setup records with their artifacts, rejects their pending proposals — and nothing else, in no other org', async () => {
    const mine = await seed(ORG);
    const theirs = await seed(OTHER);

    const out = await resetSetup({ orgId: ORG, pluginSlug: 'software-factory', actor: 'user:usr-jamie' });

    expect(out.disconnected).toEqual([{ connector: 'github', credentials: 1 }]);
    expect(out.deleted).toEqual([{ type: 'repo', records: 1, artifacts: 1 }]);
    expect(out.rejected).toBe(1);

    // Mine: the repo and its artifact are gone, the request stays, the credential is revoked, the repo proposal is rejected.
    expect(await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.id, mine.repoId)))).toHaveLength(0);
    expect(await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.id, mine.requestId)))).toHaveLength(1);
    expect(await db.select().from(artifactSchema).where(eq(artifactSchema.orgId, ORG))).toHaveLength(0);
    const [cred] = await db.select({ revokedAt: sourceCredentialSchema.revokedAt }).from(sourceCredentialSchema).where(eq(sourceCredentialSchema.installId, mine.installId));
    expect(cred!.revokedAt).not.toBeNull();
    const runs = await db.select({ status: actionRunSchema.status, input: actionRunSchema.input }).from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    expect(runs.find(r => (r.input as { objectType: string }).objectType === 'repo')!.status).toBe('rejected');
    expect(runs.find(r => (r.input as { objectType: string }).objectType === 'request')!.status).toBe('pending');

    // Theirs: untouched.
    expect(await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.orgId, OTHER))).toHaveLength(2);
    expect(await db.select().from(artifactSchema).where(eq(artifactSchema.orgId, OTHER))).toHaveLength(1);
    const [theirCred] = await db.select({ revokedAt: sourceCredentialSchema.revokedAt }).from(sourceCredentialSchema).where(eq(sourceCredentialSchema.installId, theirs.installId));
    expect(theirCred!.revokedAt).toBeNull();
  });

  it('refuses a plugin that declares no setup', async () => {
    await expect(resetSetup({ orgId: ORG, pluginSlug: 'wiki', actor: 'user:usr-jamie' })).rejects.toThrow(/declares no setup/);
  });
});
