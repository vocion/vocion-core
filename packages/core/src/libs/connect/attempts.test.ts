/**
 * Connect attempts in `source_audit`, against PGlite (#1080). What matters:
 * the newest attempt wins per connector, and one workspace never sees another's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { sourceAuditSchema } = await import('@/models/Schema');
const { lastConnectAttempts, recordConnectAttempt } = await import('./attempts');

const ORG = 'org_attempts';

async function insertAt(input: { orgId: string; connector: string; at: string; reason?: string }) {
  await db.insert(sourceAuditSchema).values({
    orgId: input.orgId,
    userId: 'user_a',
    event: input.reason ? 'failed_auth' : 'connected',
    metadata: { provider: input.connector, connector: input.connector, reason: input.reason ?? null },
    at: new Date(input.at),
  });
}

afterEach(async () => {
  await db.delete(sourceAuditSchema);
});

describe('lastConnectAttempts', () => {
  it('holds the newest attempt per connector and nothing from another org', async () => {
    await insertAt({ orgId: ORG, connector: 'github', at: '2026-10-01T10:00:00Z', reason: 'access_denied' });
    await insertAt({ orgId: ORG, connector: 'github', at: '2026-10-01T11:00:00Z' });
    await insertAt({ orgId: ORG, connector: 'slack', at: '2026-10-01T09:00:00Z', reason: 'state_expired' });
    await insertAt({ orgId: 'org_other', connector: 'github', at: '2026-10-02T09:00:00Z', reason: 'access_denied' });

    const attempts = await lastConnectAttempts(ORG);

    expect([...attempts.keys()].sort()).toEqual(['github', 'slack']);
    expect(attempts.get('github')).toMatchObject({ ok: true, reason: null, at: new Date('2026-10-01T11:00:00Z') });
    expect(attempts.get('slack')).toMatchObject({ ok: false, reason: 'state_expired', summary: null });
  });
});

describe('recordConnectAttempt', () => {
  it('stores a failure with its worded summary, and a success without a reason', async () => {
    await recordConnectAttempt({ orgId: ORG, userId: 'user_a', provider: 'github', providerLabel: 'GitHub', connector: 'github', ok: false, reason: 'access_denied' });
    const failed = (await lastConnectAttempts(ORG)).get('github');

    expect(failed).toMatchObject({ ok: false, reason: 'access_denied', summary: 'GitHub denied access', provider: 'github', userId: 'user_a' });
    expect(failed?.at).toBeInstanceOf(Date);

    await recordConnectAttempt({ orgId: ORG, userId: 'user_a', provider: 'github', providerLabel: 'GitHub', connector: 'github', ok: true });
    const ok = (await lastConnectAttempts(ORG)).get('github');

    expect(ok).toMatchObject({ ok: true, reason: null, summary: null });
  });
});
