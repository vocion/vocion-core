/**
 * User profile — the signed-in USER's own account (not team members).
 *
 * Backs the /dashboard/profile page: read name/email, update the display
 * name, and change the password (Credentials provider only — OAuth-only
 * users have no passwordHash and cannot change a password here).
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { hashPassword, verifyPassword } from '@/libs/identity/password';
import { userSchema } from '@/models/Schema';
import { endOtherSessions } from '@/services/auth/sessionVersion';

export type UserProfile = {
  name: string | null;
  email: string;
  /** Mobile number in E.164, for texts (`me.set_phone` sets it from chat too). */
  phone: string | null;
};

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const [user] = await db
    .select({ name: userSchema.name, email: userSchema.email, phone: userSchema.phone })
    .from(userSchema)
    .where(eq(userSchema.id, userId))
    .limit(1);
  return user ?? null;
}

/**
 * Whether the person can sign in with a password (a Google-only login cannot).
 * @param userId - The person.
 */
export async function hasPassword(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ passwordHash: userSchema.passwordHash })
    .from(userSchema)
    .where(eq(userSchema.id, userId))
    .limit(1);
  return Boolean(user?.passwordHash);
}

export async function updateProfile(opts: { userId: string; name: string }): Promise<void> {
  const name = opts.name.trim();
  if (!name) {
    throw new Error('Name cannot be empty.');
  }
  await db
    .update(userSchema)
    .set({ name })
    .where(eq(userSchema.id, opts.userId));
}

/**
 * Keep, change or clear the person's mobile number. Empty clears it; anything else must read as a
 * phone number, and one another member holds is refused.
 * @param opts - Who, and the number as typed.
 * @param opts.userId
 * @param opts.phone
 * @returns The number kept, in E.164, or null when cleared.
 */
export async function updatePhone(opts: { userId: string; phone: string }): Promise<string | null> {
  const { toE164 } = await import('@/libs/phone');
  const typed = opts.phone.trim();
  const phone = typed ? toE164(typed) : null;
  if (typed && !phone) {
    throw new Error('That is not a phone number Vocion can text. Include the country code (+1 for the US).');
  }
  if (phone) {
    const [holder] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.phone, phone)).limit(1);
    if (holder && holder.id !== opts.userId) {
      throw new Error('That number is already on another member\'s profile.');
    }
  }
  await db.update(userSchema).set({ phone }).where(eq(userSchema.id, opts.userId));
  return phone;
}

export async function changePassword(opts: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  if (opts.newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }

  const [user] = await db
    .select({ passwordHash: userSchema.passwordHash })
    .from(userSchema)
    .where(eq(userSchema.id, opts.userId))
    .limit(1);
  if (!user) {
    throw new Error('User not found.');
  }
  if (!user.passwordHash) {
    throw new Error('This account has no password set (OAuth sign-in).');
  }

  // Same verification the Credentials provider uses in libs/Auth.ts.
  const ok = await verifyPassword(opts.currentPassword, user.passwordHash);
  if (!ok) {
    throw new Error('Current password is incorrect.');
  }

  const passwordHash = await hashPassword(opts.newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(userSchema)
      .set({ passwordHash })
      .where(eq(userSchema.id, opts.userId));
    // A new password ends every other session; the route keeps the one the
    // change was made from (`keepThisSession`).
    await endOtherSessions(opts.userId, tx);
  });
}
