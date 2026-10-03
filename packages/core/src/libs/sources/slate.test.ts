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

  it('defaults to team visibility, and the form offers no visibility the schema refuses', () => {
    expect(slateConnector.configSchema.parse({})).toMatchObject({ visibility: 'team' });

    const options = CONFIG_FIELDS.slate!.find(f => f.key === 'visibility')!.options!.map(o => o.value);

    expect(options.every(v => slateConnector.configSchema.safeParse({ visibility: v }).success)).toBe(true);
    expect(slateConnector.configSchema.safeParse({ visibility: 'invited' }).success).toBe(false);
  });

  it('tests the connection with /v1/me, and says whether the account may upload', async () => {
    const paid = await inspectSlate({ config: {}, credentials: CREDS }, me(200, { email: 'dana@northwind.example', name: 'Dana Okafor', paidSeat: true }));

    expect(paid).toMatchObject({ reachable: true, authorized: true, error: null });
    expect(paid.checks.map(c => [c.key, c.ok])).toEqual([['account', true], ['uploads', true]]);
    expect(paid.checks[0]!.detail).toContain('Dana Okafor');

    const free = await inspectSlate({ config: {}, credentials: CREDS }, me(200, { email: 'dana@northwind.example', paidSeat: false }));

    expect(free.checks.map(c => [c.key, c.ok])).toEqual([['account', true], ['uploads', false]]);
    expect(free.error).toMatch(/paid seat/);
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
