/**
 * Password hashing, in one place: bcrypt at cost 10. Kept apart from
 * `libs/Auth.ts` so a service that sets or checks a password (sign-up, the
 * profile page, a reset link) does not have to load the whole Auth.js
 * configuration to do it. `libs/Auth.ts` re-exports `hashPassword` for the
 * callers that already import it from there.
 */

import bcrypt from 'bcrypt';

/**
 * Hash a password for storage.
 * @param password - The password as typed.
 */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Whether a typed password matches a stored hash.
 * @param password - The password as typed.
 * @param hash - The stored bcrypt hash.
 */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
