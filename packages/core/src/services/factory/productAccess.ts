/**
 * PRODUCTION ACCESS LIVES WITH THE PRODUCT (Chris, 2026-09-30: "store prod env
 * and auth info with the Product in Vocion so QA or PM agent can access
 * them"). A product's environments already carry their URLs; the one a person
 * signs in to may name its QA sign-in (`qaLoginCredentialId`), an
 * `app-login` credential kept encrypted by the vault. When it names none and
 * the workspace holds exactly one live `app-login`, that one is used.
 *
 * Two readers, two depths. An agent (QA, PM) reads what it needs to reason and
 * plan: every production URL, the account email, whether a sign-in is stored.
 * The password never enters a model's context, where it would be kept in the
 * tool_call log. The worker that signs in reads the password over the API
 * (`GET /api/v1/products/:slug/access?reveal=1`, capability
 * `reveal_app_login`) at the moment it needs it.
 */

type Meta = Record<string, unknown>;

export type EnvironmentAccess = {
  slug: string;
  surface: string | null;
  url: string | null;
  login: { signInUrl: string | null; email: string | null; password?: string; stored: boolean; problem?: string } | null;
  /**
   * How QA prepares state on this environment for a live check, in the
   * product's words (`environment.liveSetup`): a standing fixture the QA
   * account keeps, what a check may create and how to remove it.
   */
  liveSetup: string | null;
};

export type ProductAccess = { product: string; environments: EnvironmentAccess[] };

const str = (m: Meta, k: string): string | null => (typeof m[k] === 'string' && (m[k] as string).trim() ? (m[k] as string).trim() : null);

/**
 * A product's production environments, with their URLs and QA sign-in.
 * @param orgId - The workspace.
 * @param product - The product's slug (`environment.product`).
 * @param opts - How deep to read.
 * @param opts.reveal - Include the password (the worker's API read only).
 * @param opts.stage - Which stage; production by default.
 */
export async function productAccess(orgId: string, product: string, opts: { reveal?: boolean; stage?: string } = {}): Promise<ProductAccess> {
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const { liveCredentialIds, resolveCredentialById } = await import('@/services/ApiTokenService');
  const stage = opts.stage ?? 'production';
  const { factoryTypes } = await import('@/libs/factory/types');
  const rows = ((await listBusinessObjects(orgId, (await factoryTypes(orgId)).environment).catch(() => [])) as Array<{ metadata: unknown }>)
    .map(r => (r.metadata ?? {}) as Meta)
    .filter(m => str(m, 'product') === product && (str(m, 'stage') ?? 'production') === stage);
  const environments: EnvironmentAccess[] = [];
  // An environment that names no sign-in uses the workspace's only live
  // `app-login`. With two or more there is nothing safe to pick, so it uses
  // none and says so.
  const needsFallback = rows.some(m => m.qaLoginCredentialId === undefined || m.qaLoginCredentialId === null);
  const liveLogins = needsFallback ? await liveCredentialIds(orgId, 'app-login') : [];
  for (const m of rows) {
    const named = m.qaLoginCredentialId === undefined || m.qaLoginCredentialId === null ? null : String(m.qaLoginCredentialId);
    const credentialId = named ?? (liveLogins.length === 1 ? liveLogins[0]! : null);
    let login: EnvironmentAccess['login'] = null;
    if (!named && liveLogins.length > 1) {
      login = { signInUrl: null, email: null, stored: false, problem: `${liveLogins.length} app logins are stored; name one on this environment.` };
    }
    if (credentialId) {
      const resolved = await resolveCredentialById(orgId, credentialId).catch(() => ({ status: 'not-found' as const }));
      if (resolved.status === 'ok') {
        const v = resolved.values as Record<string, string>;
        login = { signInUrl: v.signInUrl ?? null, email: v.email ?? null, stored: true, ...(opts.reveal ? { password: v.password } : {}) };
      } else {
        login = { signInUrl: null, email: null, stored: false, problem: `the sign-in it names is ${resolved.status}` };
      }
    }
    environments.push({ slug: str(m, 'slug') ?? 'environment', surface: str(m, 'surface'), url: str(m, 'url'), login, liveSetup: str(m, 'liveSetup') });
  }
  return { product, environments };
}
