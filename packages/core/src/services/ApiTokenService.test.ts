/**
 * API token lifecycle against PGlite: issue → authenticate → principal, plus
 * wrong-secret / revoked / malformed rejection. The token's principal is what
 * the write API hands to authz.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema } = await import('@/models/Schema');
const { issueToken, verifyToken, authenticateBearer, revokeToken } = await import('@/services/ApiTokenService');

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
});
