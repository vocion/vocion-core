import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  contextStatements,
  currentTenantContext,
  isTenantContextEnabled,
  runAsSystem,
  runWithTenantScope,
  setRequestTenant,
} from './tenantContext';

describe('tenant context', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off unless VOCION_DB_TENANT_CONTEXT is exactly 1', () => {
    vi.stubEnv('VOCION_DB_TENANT_CONTEXT', '');

    expect(isTenantContextEnabled()).toBe(false);

    vi.stubEnv('VOCION_DB_TENANT_CONTEXT', 'true');

    expect(isTenantContextEnabled()).toBe(false);

    vi.stubEnv('VOCION_DB_TENANT_CONTEXT', '1');

    expect(isTenantContextEnabled()).toBe(true);
  });

  it('has no context outside a scope, and setting a tenant there does nothing', () => {
    setRequestTenant({ accountId: 'acct_northwind', userId: 'user_1' });

    expect(currentTenantContext()).toBeUndefined();
    expect(contextStatements(currentTenantContext())).toBeNull();
  });

  it('labels nothing in a request scope until its tenant is resolved', async () => {
    await runWithTenantScope(async () => {
      expect(contextStatements(currentTenantContext())).toBeNull();

      setRequestTenant({ accountId: 'acct_northwind', userId: 'user_1' });
      await Promise.resolve();

      expect(contextStatements(currentTenantContext())).toEqual([{
        text: expect.stringContaining(`set_config('app.account_id', $1, true)`),
        values: ['acct_northwind', 'user_1'],
      }]);
    });
  });

  it('keeps two concurrent requests apart', async () => {
    const seen: Array<string | undefined> = [];
    const request = (accountId: string, delay: number) => runWithTenantScope(async () => {
      setRequestTenant({ accountId });
      await new Promise(resolve => setTimeout(resolve, delay));
      const ctx = currentTenantContext();
      seen.push(ctx?.kind === 'tenant' ? ctx.accountId : undefined);
    });
    await Promise.all([request('acct_northwind', 20), request('acct_kestrel', 5)]);

    expect(seen).toEqual(['acct_kestrel', 'acct_northwind']);
  });

  it('runs system work with an empty tenant, and a request cannot relabel it', async () => {
    await runWithTenantScope(async () => {
      setRequestTenant({ accountId: 'acct_northwind' });
      await runAsSystem('test', async () => {
        setRequestTenant({ accountId: 'acct_kestrel' });

        expect(currentTenantContext()).toEqual({ kind: 'system', reason: 'test' });
        expect(contextStatements(currentTenantContext(), undefined)).toEqual([{
          text: expect.stringContaining(`set_config('app.context', 'system', true)`),
        }]);
      });

      // Back in the request, its own tenant again.
      expect(currentTenantContext()).toEqual({ kind: 'tenant', accountId: 'acct_northwind', userId: undefined });
    });
  });

  it('switches system work to the configured role, and refuses a role that is not a plain name', () => {
    const system = { kind: 'system', reason: 'test' } as const;

    expect(contextStatements(system, 'app_system')?.at(-1)).toEqual({ text: 'set local role "app_system"' });
    expect(() => contextStatements(system, 'x"; drop table project; --')).toThrow(/plain role name/);
  });
});
