import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Whether the access a failed run lacked is in place now, read from the
 * stored grant the run would spend, never from the vendor.
 */

const credentials = vi.fn<(orgId: string, source: string) => Promise<Record<string, unknown> | undefined>>();
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: (orgId: string, source: string) => credentials(orgId, source) }));
vi.mock('@/services/ActionService', () => ({ sourceSlugOf: (action: { sourceSlug?: string }) => action.sourceSlug ?? null }));
vi.mock('@/libs/actions/registry', () => ({ getAction: (id: string) => (id.startsWith('gmail.') ? { id, sourceSlug: 'gmail' } : { id }) }));

const { accessGrantedSince } = await import('./accessGranted');
const { GOOGLE_EXTRA_ACCESS, GOOGLE_LOGIN_SCOPES } = await import('@/libs/connect/providers/google');

const SCOPE_ERROR = 'Gmail draft failed: 403 { "error": { "code": 403, "message": "Request had insufficient authentication scopes.", "status": "PERMISSION_DENIED", "details": [ { "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "metadata": { "service": "gmail.googleapis.com", "method": "caribou.api.proto.MailboxService.CreateDraft" } } ] } }';
const READONLY = GOOGLE_LOGIN_SCOPES.gmail!.join(' ');
const COMPOSE = GOOGLE_EXTRA_ACCESS.gmail!.compose!.join(' ');
const run = { actionId: 'gmail.send', input: { to: 'pat@noco.example' }, error: SCOPE_ERROR };

beforeEach(() => {
  credentials.mockReset();
});

describe('accessGrantedSince', () => {
  it('is true once the run\'s Gmail grant holds compose, and reads that grant', async () => {
    credentials.mockResolvedValue({ email: 'ann@noco.example', refreshToken: '1//r', scope: `openid email ${READONLY} ${COMPOSE}` });

    await expect(accessGrantedSince('org_a', run)).resolves.toBe(true);
    expect(credentials).toHaveBeenCalledWith('org_a', 'gmail');
  });

  it('is false while the grant is still read-only', async () => {
    credentials.mockResolvedValue({ refreshToken: '1//r', scope: `openid email ${READONLY}` });

    await expect(accessGrantedSince('org_a', run)).resolves.toBe(false);
  });

  it('cannot tell for a failure that is not about access, and reads nothing for one', async () => {
    await expect(accessGrantedSince('org_a', { ...run, error: 'Gmail draft failed: 500 backend error' })).resolves.toBeNull();
    await expect(accessGrantedSince('org_a', { ...run, error: null })).resolves.toBeNull();
    expect(credentials).not.toHaveBeenCalled();
  });

  it('cannot tell when there is no grant, or reading it fails', async () => {
    credentials.mockResolvedValueOnce(undefined);

    await expect(accessGrantedSince('org_a', run)).resolves.toBeNull();

    credentials.mockRejectedValueOnce(new Error('vault down'));

    await expect(accessGrantedSince('org_a', run)).resolves.toBeNull();
  });
});
