/**
 * API token lifecycle against PGlite: issue → authenticate → principal, plus
 * wrong-secret / revoked / expired / malformed rejection and the org-scoped
 * list the dashboard renders. The token's principal is what the write API
 * hands to authz.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema } = await import('@/models/Schema');
const { issueToken, verifyToken, authenticateBearer, revokeToken, listTokens } = await import('@/services/ApiTokenService');

const ORG = 'org_token_test';

beforeEach(async () => {
  await db.delete(apiTokenSchema);
});

afterAll(async () => {
  await db.delete(apiTokenSchema);
});

describe('ApiTokenService', () => {
  it('issues a vcn_live token and verifies it into an authz principal', async () => {
    const { token, id } = await issueToken({ orgId: ORG, name: 'FirstHQ app', role: 'pm', grants: ['send_email'] });

    expect(token.startsWith(`vcn_live_${id}_`)).toBe(true);

    const identity = await verifyToken(token);

    expect(identity).not.toBeNull();
    expect(identity!.orgId).toBe(ORG);
    expect(identity!.principal).toMatchObject({
      kind: 'user',
      role: 'pm',
      scope: { orgId: ORG },
      grants: ['send_email'],
    });
  });

  it('rejects a tampered secret', async () => {
    const { token } = await issueToken({ orgId: ORG, name: 't' });
    const tampered = `${token.slice(0, -2)}xy`;

    expect(await verifyToken(tampered)).toBeNull();
  });

  it('rejects a revoked token', async () => {
    const { token, id } = await issueToken({ orgId: ORG, name: 't' });
    await revokeToken(ORG, id);

    expect(await verifyToken(token)).toBeNull();
  });

  it('rejects malformed input and non-Bearer headers', async () => {
    expect(await verifyToken('garbage')).toBeNull();
    expect(await verifyToken('vcn_live_only')).toBeNull();
    expect(await authenticateBearer(undefined)).toBeNull();
    expect(await authenticateBearer('Basic abc')).toBeNull();
  });

  it('authenticates a Bearer header', async () => {
    const { token } = await issueToken({ orgId: ORG, name: 't' });
    const identity = await authenticateBearer(`Bearer ${token}`);

    expect(identity?.orgId).toBe(ORG);
  });

  it('verifies a token whose expiry is still in the future', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { token } = await issueToken({ orgId: ORG, name: 'dated', expiresAt: tomorrow });

    expect(await verifyToken(token)).not.toBeNull();
  });

  it('rejects a token whose expiry has passed', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { token } = await issueToken({ orgId: ORG, name: 'stale', expiresAt: yesterday });

    expect(await verifyToken(token)).toBeNull();
  });

  it('treats a token issued with no expiry as never expiring', async () => {
    const { token, id } = await issueToken({ orgId: ORG, name: 'forever' });
    const [row] = await listTokens(ORG);

    expect(row?.id).toBe(id);
    expect(row?.expiresAt).toBeNull();
    expect(await verifyToken(token)).not.toBeNull();
  });

  it('lists expiry alongside the rest of a token row, without the secret', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await issueToken({ orgId: ORG, name: 'panel', expiresAt });
    const [row] = await listTokens(ORG);

    expect(row?.name).toBe('panel');
    expect(row?.expiresAt?.getTime()).toBe(expiresAt.getTime());
    expect(row).not.toHaveProperty('secretHash');
  });

  it('scopes the list to one org', async () => {
    await issueToken({ orgId: ORG, name: 'ours' });
    await issueToken({ orgId: 'org_someone_else', name: 'theirs' });

    expect((await listTokens(ORG)).map(t => t.name)).toEqual(['ours']);
  });
});
