import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, inviteSchema, userSchema } from '@/models/Schema';

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

  // Reject duplicate emails
  const [existingUser] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, lowerEmail)).limit(1);
  if (existingUser) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }

  const [invite] = await db.select().from(inviteSchema).where(eq(inviteSchema.token, inviteToken)).limit(1);
  if (!invite) {
    return NextResponse.json({ error: 'Invalid invite token.' }, { status: 404 });
  }
  if (invite.acceptedAt) {
    return NextResponse.json({ error: 'This invite has already been used.' }, { status: 410 });
  }
  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This invite has expired.' }, { status: 410 });
  }
  if (invite.email.toLowerCase() !== lowerEmail) {
    return NextResponse.json({ error: 'This invite was issued for a different email.' }, { status: 403 });
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
  return NextResponse.json({ ok: true, userId, mode: 'invite-accept' });
}
