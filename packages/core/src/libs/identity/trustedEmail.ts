/**
 * The email address a sign-in provider vouches for, read from its ID token.
 *
 * This is the only thing Vocion takes from a provider to decide who someone
 * is the first time they use it: the address is matched to an existing login
 * or a pending invite (`services/auth/signInDecision.ts`). So it must be an
 * address the provider has actually checked, never one a stranger could type
 * into their own profile. Each provider says that differently:
 *
 * - **Google** sets `email_verified`. Anything else is refused.
 * - **Microsoft Entra ID** has no `email_verified`. A tenant admin can put any
 *   address in a user's `mail` attribute, and Entra will emit it as `email`
 *   (the "nOAuth" account-takeover pattern), so `email` alone proves nothing.
 *   Two claims are trustworthy:
 *   1. `email` when `xms_edov` is true — Entra's own statement that the
 *      address's domain is verified by the tenant that issued the token
 *      (an optional claim the app registration has to request);
 *   2. otherwise `preferred_username`, the user principal name, whose domain
 *      Entra only allows to be a domain verified in that tenant (or the
 *      tenant's own `*.onmicrosoft.com`). A domain can be verified in one
 *      tenant at a time, so a tenant can only mint names in domains it owns.
 *
 *   The token must also come from a real tenant: `iss` has to be exactly
 *   `https://login.microsoftonline.com/<tid>/v2.0` for the token's own `tid`
 *   (Auth.js has already checked the signature against that tenant's keys),
 *   and the consumer tenant that holds personal Microsoft accounts is refused,
 *   because this deployment signs in work and school accounts only.
 *
 * Pure functions over the claims, so the rules are tested without Auth.js.
 */

/** What a provider vouches for: a verified address, or why there is none. */
export type TrustedEmail
  = | { ok: true; email: string }
    | { ok: false; reason: TrustedEmailRefusal };

/**
 * Why a provider's token names no address Vocion can match:
 * - `unverified-email`: the provider did not vouch for any address;
 * - `untrusted-issuer`: the token's issuer is not the tenant it claims;
 * - `personal-account`: a personal Microsoft account, where only work or school ones are taken.
 */
export type TrustedEmailRefusal = 'unverified-email' | 'untrusted-issuer' | 'personal-account';

/** The claims these rules read. Every one is optional: a token is untrusted input. */
export type IdTokenClaims = Record<string, unknown>;

/**
 * The tenant id Entra issues personal Microsoft accounts (outlook.com,
 * hotmail.com, live.com) under. Published by Microsoft; fixed.
 */
export const MICROSOFT_PERSONAL_ACCOUNTS_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * An address-shaped string, lowercased and trimmed, or null. Deliberately
 * loose — one `@` with something on each side and a dot in the domain — since
 * the address is only ever compared for equality with stored ones.
 * @param value - A claim value.
 */
export function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const email = value.trim().toLowerCase();
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || /\s/.test(email)) {
    return null;
  }
  const domain = email.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.') ? email : null;
}

/**
 * The address Google vouches for: `email`, only when `email_verified` is true.
 * @param claims - Google's ID token claims.
 */
export function googleTrustedEmail(claims: IdTokenClaims | null | undefined): TrustedEmail {
  const email = normalizedEmail(claims?.email);
  // Strictly `true`: a string "true" or a missing claim is not Google's word.
  if (!email || claims?.email_verified !== true) {
    return { ok: false, reason: 'unverified-email' };
  }
  return { ok: true, email };
}

/**
 * Whether an Entra ID token was issued by the tenant it names: `iss` is the
 * tenant-specific v2.0 issuer for the token's own `tid`. With the
 * multi-tenant `organizations` endpoint the issuer differs per tenant, so it
 * is checked against this template rather than one fixed string.
 * @param claims - The ID token claims.
 */
export function entraIssuerMatchesTenant(claims: IdTokenClaims | null | undefined): boolean {
  const tid = claims?.tid;
  return typeof tid === 'string'
    && TENANT_ID.test(tid)
    && claims?.iss === `https://login.microsoftonline.com/${tid}/v2.0`;
}

/**
 * The address Microsoft Entra ID vouches for, by the rules in the module
 * docstring: the tenant must be real and not the personal-accounts one; then
 * `email` if `xms_edov` is true, else the sign-in name.
 * @param claims - Entra's ID token claims.
 */
export function entraTrustedEmail(claims: IdTokenClaims | null | undefined): TrustedEmail {
  if (!entraIssuerMatchesTenant(claims)) {
    return { ok: false, reason: 'untrusted-issuer' };
  }
  if (claims?.tid === MICROSOFT_PERSONAL_ACCOUNTS_TENANT) {
    return { ok: false, reason: 'personal-account' };
  }
  const verifiedMail = claims?.xms_edov === true ? normalizedEmail(claims?.email) : null;
  const email = verifiedMail ?? normalizedEmail(claims?.preferred_username);
  return email ? { ok: true, email } : { ok: false, reason: 'unverified-email' };
}
