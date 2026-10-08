import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { hashPassword } from '@/libs/identity/password';
import { userSchema } from '@/models/Schema';
import { acceptInviteAsNewUser } from '@/services/InviteAcceptance';

/**
 * Registration endpoint. Accepting an invite is the ONLY way to create an
 * account through the web.
 *
 * This route used to double as first-run setup: while the instance had no
 * users, an unauthenticated POST created the tenant account, its default
 * project and an admin user. That made every reachable deployment claimable
 * by whoever found it first — a self-hosted URL is guessable (dev/staging
 * subdomains of a known production hostname), and the window stayed open
 * from the moment the box served traffic until a human happened to sign up.
 *
 * The first admin is now created on the instance instead, where being able
 * to run the command is the authorization:
 *
 *   tsx src/scripts/create-local-user.ts --email you@example.com
 *       --name "You" --role admin            (run inside packages/core)
 *
 * That script prints a generated password when none is passed. Everyone
 * after the first joins by invite from inside the dashboard.
 *
 * This creates a NEW user. Someone who already has a login accepts an invite
 * into another account by signing in and joining on that login
 * (`/api/invites/accept`), so one person stays one user with a membership per
 * account; the 409 below says so, with `code: 'EXISTING_USER'` for the form.
 */

const bodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  inviteToken: z.string().min(1),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'An invite token is required to create an account.' }, { status: 403 });
  }
  const { name, email, password, inviteToken } = parsed.data;
  const lowerEmail = email.toLowerCase();

  // An existing login joins by signing in, never by making a second user.
  // Checked before the password is hashed, so the answer costs no bcrypt.
  const [existingUser] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, lowerEmail)).limit(1);
  if (existingUser) {
    return NextResponse.json(
      { error: 'You already have a login with this email. Sign in to accept the invite.', code: 'EXISTING_USER' },
      { status: 409 },
    );
  }

  // The same path a first sign-in with Google, Microsoft or an email link
  // takes (`services/auth/externalSignIn.ts`): one way a login is made.
  const result = await acceptInviteAsNewUser({ inviteToken, email: lowerEmail, name, passwordHash: await hashPassword(password) });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...(result.code ? { code: result.code } : {}) }, { status: result.status });
  }
  return NextResponse.json({ ok: true, userId: result.userId, mode: 'invite-accept' });
}
