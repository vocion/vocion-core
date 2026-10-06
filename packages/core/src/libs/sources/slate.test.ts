import type { SlateFetch } from '@/libs/slate/client';
import { describe, expect, it } from 'vitest';
import { getPlatform, validatePlatformCredential } from '@/libs/platforms/registry';
import { CONFIG_FIELDS } from './configFields';
import { getConnector } from './registry';
import { inspectSlate, slateConnector } from './slate';

const CREDS = { token: 'slt_fixture_token_0001' };

function me(status: number, json: unknown): SlateFetch {
  return async () => ({ ok: status === 200, status, json: async () => json, text: async () => JSON.stringify(json), headers: { get: () => null } });
}

describe('the slate connector', () => {
  it('is registered, sync-less, and takes a session token as its one secret', () => {
    expect(getConnector('slate')).toBe(slateConnector);
    expect(slateConnector.syncless).toBe(true);
    expect(slateConnector.authKind).toBe('apikey');
    expect(getPlatform('slate').fields.map(f => [f.name, f.secret])).toEqual([['token', true]]);
    expect(getPlatform('slate').connectorSlugs).toEqual(['slate']);
    expect(validatePlatformCredential('slate', { token: 'slt_fixture_token_0001' })).toEqual({ token: 'slt_fixture_token_0001' });
    expect(() => validatePlatformCredential('slate', { token: 'sk-not-a-slate-token-000' })).toThrow(/slt_/);
  });

  it('configures only where the API lives, and the form offers nothing the schema refuses', () => {
    expect(slateConnector.configSchema.parse({})).toEqual({ apiBase: 'https://api.slatevideo.com' });
    expect(CONFIG_FIELDS.slate!.map(f => f.key)).toEqual(['apiBase']);
    expect(slateConnector.configSchema.safeParse({ apiBase: 'not a url' }).success).toBe(false);
  });

  it('tests the connection with /v1/me and says whose account the token is', async () => {
    const r = await inspectSlate({ config: {}, credentials: CREDS }, me(200, { email: 'dana@northwind.example', name: 'Dana Okafor', paidSeat: true }));

    expect(r).toMatchObject({ reachable: true, authorized: true, error: null });
    expect(r.checks.map(c => [c.key, c.ok])).toEqual([['account', true]]);
    expect(r.checks[0]!.detail).toContain('Dana Okafor');
  });

  it('says a refused token in words a person acts on', async () => {
    const r = await inspectSlate({ config: {}, credentials: CREDS }, me(401, { message: 'Unauthorized' }));

    expect(r).toMatchObject({ reachable: true, authorized: false });
    expect(r.error).toMatch(/refused the token/);
  });

  it('refuses to inspect without a token', async () => {
    await expect(inspectSlate({ config: {}, credentials: {} })).rejects.toThrow(/No Slate token/);
  });
});
