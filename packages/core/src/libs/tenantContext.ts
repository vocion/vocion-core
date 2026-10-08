/**
 * THE TENANT A DATABASE CALL RUNS FOR — a request-scoped context, read by the
 * database pool.
 *
 * Every query the app makes already filters by tenant in the service layer.
 * This is a second, independent layer under that one: when it is switched on,
 * each query is sent inside a transaction that first records who the work is
 * for as Postgres settings:
 *
 * - `app.account_id`, the tenant (the account) the request resolved to;
 * - `app.user_id`, the signed-in person, when there is one;
 * - `app.context`, `tenant` or `system`.
 *
 * Core installs nothing that reads them. An installation may add its own
 * database policies (row-level security, auditing triggers) that do, as
 * defense in depth: a query that forgets its tenant filter is then still
 * confined by the database itself.
 *
 * Off by default. With `VOCION_DB_TENANT_CONTEXT` unset (or anything but `1`),
 * nothing here changes a single query. Only node-postgres connections take
 * part; the in-process PGlite driver used by the demo sandbox ignores it.
 *
 * ## How a context is set
 *
 * - **Requests.** The `/rpc` endpoint opens an empty scope per request
 *   ({@link runWithTenantScope}); `guardAuth` fills it once tenancy is
 *   resolved ({@link setRequestTenant}). Another entry point opts in by
 *   wrapping its handler the same way.
 * - **System work.** Background paths that legitimately span tenants (the
 *   durable executor, the feedback worker, tenancy resolution itself) run under
 *   {@link runAsSystem}. A system context sets `app.context = 'system'` and an
 *   empty `app.account_id`; when `VOCION_DB_SYSTEM_ROLE` names a role, it also
 *   switches to that role for the transaction (`SET LOCAL ROLE`), so an
 *   installation can give that role whatever access background work needs.
 * - **Nothing.** Outside any scope, or in a request whose tenant was never
 *   resolved, the query is sent as-is. Whatever policy an installation has
 *   decides what an unlabelled query may see; failing closed is the safe one.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import process from 'node:process';

/** Who a piece of database work is for. */
export type TenantContext
  = | {
    kind: 'tenant';
    /** The account (tenant) the request resolved to; unset until it has. */
    accountId?: string;
    /** The signed-in person, when there is one. */
    userId?: string;
  }
  | {
    kind: 'system';
    /** Why this work spans tenants, for whoever reads a trace of it. */
    reason: string;
  };

/** One statement to send before the work, on the same connection. */
export type ContextStatement = { text: string; values?: unknown[] };

// One store per process. Next bundles a module into more than one server
// chunk, and two copies of the store would never see each other's context
// (the same reason `libs/DB.ts` keeps its pool on globalThis).
const STORE_KEY = Symbol.for('vocion.tenantContext');
const globalStore = globalThis as unknown as Record<symbol, AsyncLocalStorage<TenantContext> | undefined>;
globalStore[STORE_KEY] ??= new AsyncLocalStorage<TenantContext>();
const storage = globalStore[STORE_KEY]!;

/** True when queries carry the tenant context (`VOCION_DB_TENANT_CONTEXT=1`). */
export function isTenantContextEnabled(): boolean {
  return process.env.VOCION_DB_TENANT_CONTEXT === '1';
}

/** The context the current code runs in, if any. */
export function currentTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Run `fn` in a fresh, empty request scope. {@link setRequestTenant} fills it
 * once the request's tenant is known; until then queries carry nothing.
 * @param fn - The request's work.
 */
export function runWithTenantScope<T>(fn: () => T): T {
  return storage.run({ kind: 'tenant' }, fn);
}

/**
 * Record the tenant of the request this code runs in. A no-op outside a
 * request scope, and inside a system context: neither is a request's to label.
 * @param tenant - The resolved tenant.
 * @param tenant.accountId - The account (tenant) id.
 * @param tenant.userId - The signed-in person, when there is one.
 */
export function setRequestTenant(tenant: { accountId: string | null | undefined; userId?: string | null }): void {
  const scope = storage.getStore();
  if (scope?.kind !== 'tenant') {
    return;
  }
  scope.accountId = tenant.accountId ?? undefined;
  scope.userId = tenant.userId ?? undefined;
}

/**
 * Run `fn` as system work: it legitimately spans tenants. Use it for
 * background loops, schedulers and the tenancy lookup itself, never to get
 * around a request's own tenant.
 * @param reason - Why, in a few words (e.g. `durable-executor`).
 * @param fn - The work.
 */
export function runAsSystem<T>(reason: string, fn: () => T): T {
  return storage.run({ kind: 'system', reason }, fn);
}

const ROLE_NAME = /^[a-z_][\w$]{0,62}$/i;

/**
 * The statements that label a transaction with `ctx`, or `null` when there is
 * nothing to label (no context, or a request whose tenant is not resolved).
 * @param ctx - The context, usually {@link currentTenantContext}.
 * @param systemRole - The role system work switches to, if any.
 */
export function contextStatements(ctx: TenantContext | undefined, systemRole = process.env.VOCION_DB_SYSTEM_ROLE): ContextStatement[] | null {
  if (!ctx) {
    return null;
  }
  if (ctx.kind === 'system') {
    const statements: ContextStatement[] = [{
      text: `select set_config('app.context', 'system', true), set_config('app.account_id', '', true), set_config('app.user_id', '', true)`,
    }];
    if (systemRole) {
      if (!ROLE_NAME.test(systemRole)) {
        throw new Error('VOCION_DB_SYSTEM_ROLE is not a plain role name');
      }
      statements.push({ text: `set local role "${systemRole}"` });
    }
    return statements;
  }
  if (!ctx.accountId) {
    return null;
  }
  return [{
    text: `select set_config('app.context', 'tenant', true), set_config('app.account_id', $1, true), set_config('app.user_id', $2, true)`,
    values: [ctx.accountId, ctx.userId ?? ''],
  }];
}
