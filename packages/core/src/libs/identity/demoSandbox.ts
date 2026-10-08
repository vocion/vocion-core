/**
 * The public demo sandbox: a deployment booted from a seed directory
 * (`VOCION_DEMO_SEED_DIR`) whose sign-in page shows one shared login
 * (`VOCION_DEMO_HINT_EMAIL`) to every visitor.
 *
 * Sign-in treats it differently in three places, all for the same reason —
 * every visitor is the same person, so anything one visitor does to "their"
 * sign-in happens to the next visitor too:
 *
 * - the shared login is exempt from the per-email lockout, so ten wrong
 *   passwords from one visitor cannot lock out the rest;
 * - two-step sign-in cannot be set up or required, so one visitor cannot put
 *   an authenticator only they hold in front of everyone else;
 * - other sessions are not ended by a password change, because the sandbox's
 *   proxy gates on the cookie alone (it cannot read the database) and a
 *   session the server has ended would bounce between sign-in and dashboard.
 */

import process from 'node:process';

/** Whether this deployment is the demo sandbox. */
export function isDemoSandbox(): boolean {
  return Boolean(process.env.VOCION_DEMO_SEED_DIR);
}

/**
 * Whether `email` is the login the demo sandbox shows every visitor. False on
 * every other deployment, whatever the email.
 * @param email - The email being signed in with.
 */
export function isDemoSharedLogin(email: string): boolean {
  const shared = process.env.VOCION_DEMO_HINT_EMAIL?.trim().toLowerCase();
  return isDemoSandbox() && Boolean(shared) && email.trim().toLowerCase() === shared;
}
