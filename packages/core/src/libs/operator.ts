/**
 * Who operates this installation — the people who run the deployment
 * itself, across every company on it, as opposed to an admin of one
 * company's account.
 *
 * The smallest notion that holds: `VOCION_OPERATOR_EMAILS`, a comma- or
 * space-separated list, checked on the server against the signed-in user's
 * email as the database holds it. Unset means nobody is an operator, so
 * nothing installation-wide is shown to anyone — the safe default on a host
 * that serves several companies. An account admin is not an operator: on a
 * shared host their account is one company among several.
 *
 * An operator's login is made on the instance (`create-local-user`), never
 * by invite — `/api/signup` refuses a listed email, so a client admin cannot
 * invite the address and claim it.
 */

import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';

/** The configured operator emails, lowercased. Empty when the variable is unset. */
export function operatorEmails(): ReadonlySet<string> {
  const raw = process.env.VOCION_OPERATOR_EMAILS ?? '';
  return new Set(raw.split(/[\s,]+/).map(e => e.trim().toLowerCase()).filter(e => e !== ''));
}

/**
 * Whether an email is on the operator list.
 * @param email - The address, any case.
 */
export function isOperatorEmail(email: string | null | undefined): boolean {
  return !!email && operatorEmails().has(email.trim().toLowerCase());
}

/**
 * Whether the signed-in user operates this installation. Reads the email
 * from the user row rather than trusting anything the client sent.
 * @param userId - The session's user id.
 */
export async function isOperator(userId: string | null | undefined): Promise<boolean> {
  if (!userId || operatorEmails().size === 0) {
    return false;
  }
  const [row] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  return isOperatorEmail(row?.email);
}
