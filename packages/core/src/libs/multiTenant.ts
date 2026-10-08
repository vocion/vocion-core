/**
 * WHETHER THIS INSTALLATION SERVES SEVERAL COMPANIES. A self-hosted Vocion has one account and
 * trusts its own installation-wide secrets; Vocion Cloud hosts several accounts on one deployment,
 * and anything installation-wide that reaches a tenant's code is a key to every other tenant.
 *
 * `VOCION_MULTI_TENANT=1` says so. Unset means single-tenant, the behaviour every existing
 * installation has. Read where an installation-wide credential would otherwise be honoured: the
 * runner claim refuses `VOCION_RUNNER_TOKEN` on a multi-tenant installation
 * (`app/api/v1/runner/claim/route.ts`), so every runner there holds one account's token.
 */

/**
 * True when the deployment declares it serves several accounts.
 * @param env - The process environment; a test passes its own.
 */
export function isMultiTenant(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const v = env.VOCION_MULTI_TENANT?.trim().toLowerCase();
  return v === '1' || v === 'true';
}
