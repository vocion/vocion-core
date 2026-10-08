/**
 * The external sign-in providers this deployment offers: "Continue with
 * Google", "Continue with Microsoft", and any an extension adds.
 *
 * One list, read by everything that has to agree about it: `libs/Auth.ts`
 * registers exactly these with Auth.js, the sign-in and invite pages render a
 * button for exactly these, and the profile page offers to link or unlink
 * exactly these. A provider whose settings are missing is in none of them —
 * no button that leads to an error.
 *
 * A provider is a descriptor, not code spread across those places. What makes
 * it safe to let in is one function, `trustedEmail`: the address the provider
 * vouches for (`libs/identity/trustedEmail.ts`). The invite-only rules
 * (`services/auth/signInDecision.ts`) read that and nothing else, so a
 * provider added here — by core or through {@link registerSignInProvider} —
 * gets the same rules: sign in a linked person, link a verified address to its
 * login, accept a pending invite, refuse everyone else.
 *
 * This is social sign-in, configured per deployment. Per-Org SSO (an Org's own
 * SAML or OIDC connection, domain capture, enforced SSO, SCIM) is not here; an
 * extension that brings it registers its providers through the same seam.
 */

import type { Provider } from 'next-auth/providers';
import type { IdTokenClaims, TrustedEmail } from './trustedEmail';
import process from 'node:process';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import { entraTrustedEmail, googleTrustedEmail } from './trustedEmail';

/** The environment a descriptor reads its settings from (`process.env` outside tests). */
export type SignInEnv = Record<string, string | undefined>;

export type SignInProviderDescriptor = {
  /**
   * Auth.js's provider id. It is also the last segment of the redirect URI
   * registered at the provider: `<app>/api/auth/callback/<id>`.
   */
  id: string;
  /** The provider's name as a person knows it: the button reads "Continue with <label>". */
  label: string;
  /** Whether this deployment set everything the provider needs. */
  configured: (env: SignInEnv) => boolean;
  /** The Auth.js provider. Only called when {@link SignInProviderDescriptor.configured}. */
  build: (env: SignInEnv) => Provider;
  /** The address the provider vouches for, from the raw ID token claims. */
  trustedEmail: (claims: IdTokenClaims | null | undefined) => TrustedEmail;
};

/** Ids Auth.js already uses for this deployment's other ways in. */
const RESERVED_IDS = new Set(['credentials', 'email']);

/**
 * Microsoft's multi-tenant endpoint for work and school accounts. Tokens come
 * back from each person's own tenant (`https://login.microsoftonline.com/<tid>/v2.0`);
 * `entraTrustedEmail` checks that issuer against the token's `tid`.
 */
export const MICROSOFT_ORGANIZATIONS_ISSUER = 'https://login.microsoftonline.com/organizations/v2.0';

/**
 * Both halves of an OAuth client are set and not blank.
 * @param env - The environment.
 * @param idVar - The client id's variable.
 * @param secretVar - The client secret's variable.
 */
function hasClient(env: SignInEnv, idVar: string, secretVar: string): boolean {
  return Boolean(env[idVar]?.trim() && env[secretVar]?.trim());
}

/**
 * The address a provider vouches for, as Auth.js's `user.email`: what it links
 * by, and null when there is none (the sign-in gate then refuses, unless the
 * provider account is already linked).
 * @param trusted - The provider's verdict.
 */
function emailOrNull(trusted: TrustedEmail): string | null {
  return trusted.ok ? trusted.email : null;
}

/**
 * A claim as a string, or null.
 * @param value - The claim.
 */
function claimString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

const google: SignInProviderDescriptor = {
  id: 'google',
  label: 'Google',
  configured: env => hasClient(env, 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'),
  build: env => Google({
    clientId: env.AUTH_GOOGLE_ID?.trim(),
    clientSecret: env.AUTH_GOOGLE_SECRET?.trim(),
    // Linking by email is safe only because the email is one Google
    // verified: `profile` below returns no email otherwise, and the sign-in
    // gate refuses an unlinked account with none.
    allowDangerousEmailAccountLinking: true,
    checks: ['pkce', 'state'],
    profile: claims => ({
      id: claims.sub,
      name: claimString(claims.name),
      email: emailOrNull(googleTrustedEmail(claims as unknown as IdTokenClaims)),
      image: claimString(claims.picture),
    }),
  }),
  trustedEmail: googleTrustedEmail,
};

const microsoft: SignInProviderDescriptor = {
  id: 'microsoft-entra-id',
  label: 'Microsoft',
  configured: env => hasClient(env, 'AUTH_MICROSOFT_ENTRA_ID_ID', 'AUTH_MICROSOFT_ENTRA_ID_SECRET'),
  build: env => MicrosoftEntraID({
    clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID?.trim(),
    clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET?.trim(),
    issuer: MICROSOFT_ORGANIZATIONS_ISSUER,
    // As for Google: `profile` returns only an address Entra vouches for.
    allowDangerousEmailAccountLinking: true,
    checks: ['pkce', 'state'],
    // No `User.Read`: the default profile fetches a photo from Microsoft
    // Graph on every sign-in, which sign-in does not need.
    authorization: { params: { scope: 'openid profile email' } },
    profile: claims => ({
      id: claims.sub,
      name: claimString(claims.name),
      email: emailOrNull(entraTrustedEmail(claims as unknown as IdTokenClaims)),
      image: null,
    }),
  }),
  trustedEmail: entraTrustedEmail,
};

const BUILT_IN: readonly SignInProviderDescriptor[] = [google, microsoft];

const registered: SignInProviderDescriptor[] = [];

/**
 * Add a provider to the list — the seam an extension uses. Must run before
 * `libs/Auth.ts` is first imported, since Auth.js reads the list once when it
 * is configured. Refuses an id that is taken.
 * @param descriptor - The provider.
 */
export function registerSignInProvider(descriptor: SignInProviderDescriptor): void {
  const taken = RESERVED_IDS.has(descriptor.id) || [...BUILT_IN, ...registered].some(d => d.id === descriptor.id);
  if (taken) {
    throw new Error(`A sign-in provider with id "${descriptor.id}" already exists.`);
  }
  registered.push(descriptor);
}

/** Every provider core knows, configured or not, then every registered one. */
export function allSignInProviders(): readonly SignInProviderDescriptor[] {
  return [...BUILT_IN, ...registered];
}

/**
 * The providers this deployment offers: the ones whose settings are present.
 * @param env - The environment; `process.env` by default.
 */
export function configuredSignInProviders(env: SignInEnv = process.env): SignInProviderDescriptor[] {
  return allSignInProviders().filter(d => d.configured(env));
}

/**
 * One provider by id, when it is offered here; null otherwise.
 * @param id - Auth.js's provider id.
 * @param env - The environment; `process.env` by default.
 */
export function configuredSignInProvider(id: string, env: SignInEnv = process.env): SignInProviderDescriptor | null {
  return configuredSignInProviders(env).find(d => d.id === id) ?? null;
}

/** What a page needs to draw the buttons: no secrets, nothing that is not shown. */
export type SignInProviderOption = { id: string; label: string };

/**
 * The buttons a page renders, in order.
 * @param env - The environment; `process.env` by default.
 */
export function signInProviderOptions(env: SignInEnv = process.env): SignInProviderOption[] {
  return configuredSignInProviders(env).map(({ id, label }) => ({ id, label }));
}
