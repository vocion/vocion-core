/**
 * User profile — the signed-in USER's own account (not team members).
 *
 * Backs the /dashboard/profile page: read name/email, update the display
 * name, and change the password (Credentials provider only — OAuth-only
 * users have no passwordHash and cannot change a password here).
 */

import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';

export type UserProfile = {
  name: string | null;
  email: string;
};

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const [user] = await db
    .select({ name: userSchema.name, email: userSchema.email })
    .from(userSchema)
    .where(eq(userSchema.id, userId))
    .limit(1);
  return user ?? null;
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
  const ok = await bcrypt.compare(opts.currentPassword, user.passwordHash);
  if (!ok) {
    throw new Error('Current password is incorrect.');
  }

  const passwordHash = await hashPassword(opts.newPassword);
  await db
    .update(userSchema)
    .set({ passwordHash })
    .where(eq(userSchema.id, opts.userId));
}
