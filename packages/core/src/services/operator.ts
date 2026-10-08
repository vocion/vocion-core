/**
 * Who operates this deployment.
 *
 * An operator runs the installation itself — on a deployment hosting several
 * client accounts, the people who create accounts, set each account's spend
 * cap and offboard an account that leaves. That is a different fact from any
 * account role: an account admin administers one client's account, and an
 * operator need not belong to any account at all to see every one of them.
 *
 * The list is configuration, not data — `VOCION_OPERATOR_EMAILS`, sign-in
 * emails separated by commas or whitespace — so no row in the database, and
 * no account admin, can make someone an operator. Unset or empty means nobody
 * is one, which is right for a self-hosted single-account install.
 *
 * Read from `process.env` on every call rather than once, so a script and the
 * app read the same value and a test can set it per case.
 */

import process from 'node:process';

/**
 * The configured operator emails, lowercased. Commas or whitespace separate
 * them, so a list pasted one per line into a secret store reads the same as
 * one written on a single line.
 */
function operatorEmails(): Set<string> {
  return new Set(
    (process.env.VOCION_OPERATOR_EMAILS ?? '')
      .split(/[\s,]+/)
      .map(entry => entry.trim().toLowerCase())
      .filter(entry => entry.length > 0),
  );
}

/**
 * Whether the person signed in with this email operates the deployment.
 * Case-insensitive, as sign-in is; an empty email is never an operator.
 * @param email - The sign-in email of the person asking.
 */
export function isOperator(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && operatorEmails().has(normalized);
}
