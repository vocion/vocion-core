import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { isOperatorEmail } from '@/libs/operator';
import { accountMembershipSchema, inviteSchema, userSchema } from '@/models/Schema';
import { inviteProblem } from '@/services/inviteRules';
import { ensurePersonalProjectsForUser } from '@/services/workspace/personalProject';

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
  const [existingUser] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, lowerEmail)).limit(1);
  if (existingUser) {
    return NextResponse.json(
      { error: 'You already have a login with this email. Sign in to accept the invite.', code: 'EXISTING_USER' },
      { status: 409 },
    );
  }

  const [invite] = await db.select().from(inviteSchema).where(eq(inviteSchema.token, inviteToken)).limit(1);
  const problem = inviteProblem(invite, lowerEmail, new Date());
  if (problem || !invite) {
    const refusal = problem ?? { status: 404, error: 'Invalid invite token.' };
    return NextResponse.json({ error: refusal.error }, { status: refusal.status });
  }

  // An operator's login is made on the instance, never by invite. Otherwise a
  // client admin could invite a listed address that has no login yet, follow
  // their own link, and operate every company on the host (`libs/operator.ts`).
  // Checked only once a valid invite for this exact address is in hand, and
  // refused in words that do not say why: before that, any caller could ask
  // which addresses operate the installation, on a sign-in with no MFA or
  // lockout. `createInvite` refuses to make such an invite in the first place.
  if (isOperatorEmail(lowerEmail)) {
    return NextResponse.json({ error: 'This invite cannot be used to create a login. Ask whoever invited you.' }, { status: 403 });
  }

  const userId = `usr-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.insert(userSchema).values({ id: userId, name, email: lowerEmail, passwordHash });
    await tx.insert(accountMembershipSchema).values({
      accountId: invite.accountId,
      userId,
      role: invite.role,
    });
    await tx.update(inviteSchema)
      .set({ acceptedAt: new Date() })
      .where(and(eq(inviteSchema.id, invite.id)));
  });
  // Their own workspace in the account the invite joined them to. Never
  // throws, so it cannot fail a sign-up; sign-in retries it.
  await ensurePersonalProjectsForUser(userId);
  return NextResponse.json({ ok: true, userId, mode: 'invite-accept' });
}
