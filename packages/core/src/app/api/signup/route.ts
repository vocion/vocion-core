import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';

const bodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  accountName: z.string().optional(),
  inviteToken: z.string().nullable().optional(),
});

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'workspace';

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });
  }
  const { name, email, password, accountName, inviteToken } = parsed.data;
  const lowerEmail = email.toLowerCase();

  // Reject duplicate emails
  const [existingUser] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, lowerEmail)).limit(1);
  if (existingUser) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }

  // Determine flow: first-run (no users yet) vs invite-accept
  const [anyUser] = await db.select({ id: userSchema.id }).from(userSchema).limit(1);

  if (!anyUser) {
    // First-run: create account + project + admin user
    if (!accountName) {
      return NextResponse.json({ error: 'Account name is required for first-run setup.' }, { status: 400 });
    }
    const accountId = `acct-${randomUUID()}`;
    const projectId = `proj-${randomUUID()}`;
    const userId = `usr-${randomUUID()}`;
    const passwordHash = await hashPassword(password);

    await db.transaction(async (tx) => {
      await tx.insert(tenantAccountSchema).values({
        id: accountId,
        name: accountName,
        slug: slugify(accountName),
      });
      await tx.insert(projectSchema).values({
        id: projectId,
        accountId,
        slug: 'default',
        name: 'Default project',
      });
      await tx.insert(userSchema).values({
        id: userId,
        name,
        email: lowerEmail,
        passwordHash,
      });
      await tx.insert(accountMembershipSchema).values({
        accountId,
        userId,
        role: 'admin',
      });
    });
    return NextResponse.json({ ok: true, accountId, projectId, userId, mode: 'first-run' });
  }

  // Invite flow
  if (!inviteToken) {
    return NextResponse.json({ error: 'An invite token is required to join this account.' }, { status: 403 });
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
