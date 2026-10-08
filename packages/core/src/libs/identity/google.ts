/**
 * Whether this deployment offers "Continue with Google": both halves of a
 * Google OAuth client are set (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`). Read by
 * `libs/Auth.ts` to register the provider and by the sign-in page to show the
 * button, so the two can never disagree. The rules for who may use it live in
 * `services/auth/googleSignIn.ts`.
 */

import process from 'node:process';

export function googleSignInConfigured(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim());
}
