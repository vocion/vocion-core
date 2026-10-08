/**
 * Invite emails from the Members page (real rows, PGlite; mail through the
 * dev mail sink, never a provider).
 *
 * Pinned: making an invite answers with the invite and what became of its
 * email — not sent with mail off, sent with mail on — and an admin past the
 * hourly allowance still gets the invite, with the reason its mail did not
 * go; "Resend email" is refused with a sentence when this server sends no
 * mail, mails the invite again when it does, and reaches only an invite in
 * the admin's own Org — the Org comes from the session, never the request;
 * and the page can ask whether invites are emailed at all.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3000' }) }));

const { db } = await import('@/libs/DB');
const schema = await import('@/models/Schema');
const { hit, RATE_LIMITS } = await import('@/libs/rateLimit');
const { readSink } = await import('@/libs/mail/sink');
const { guardAuth } = await import('./AuthGuards');
const { createInviteRoute, inviteDeliveryRoute, resendInviteRoute } = await import('./Members');

function call<T = unknown>(route: unknown, input?: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

function signedInAs(userId: string, role: 'admin' | 'member') {
  const ctx = { userId, orgId: 'proj-ops', accountId: 'acct-northwind', projectId: 'proj-ops', role, has: ({ role: wanted }: { role: string }) => wanted === 'org:member' || role === 'admin' };
  vi.mocked(guardAuth).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

type Created = { id: string; email: string; token: string; delivery: { status: string; reason?: string } };

let sink: string;

beforeEach(async () => {
  sink = await mkdtemp(join(tmpdir(), 'vocion-members-invite-'));
  for (const key of ['VOCION_MAIL_ENABLED', 'RESEND_API_KEY', 'VOCION_MAIL_FROM', 'VOCION_RATE_LIMIT', 'AUTH_URL']) {
    vi.stubEnv(key, '');
  }
  vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.northwind.example');
  await db.delete(schema.rateLimitHitSchema);
  await db.delete(schema.inviteSchema);
  await db.delete(schema.accountMembershipSchema);
  await db.delete(schema.tenantAccountSchema);
  await db.delete(schema.userSchema);
  await db.insert(schema.userSchema).values({ id: 'usr-ana', email: 'ana@northwind.example', name: 'Ana Ortiz' });
  await db.insert(schema.tenantAccountSchema).values([
    { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
    { id: 'acct-kestrel', name: 'Kestrel Capital', slug: 'kestrel' },
  ]);
  await db.insert(schema.accountMembershipSchema).values({ accountId: 'acct-northwind', userId: 'usr-ana', role: 'admin' });
  await db.insert(schema.inviteSchema).values({ id: 'inv-kestrel', accountId: 'acct-kestrel', email: 'lee@kestrel.example', role: 'member', token: 'tok-kestrel', expiresAt: new Date(Date.now() + 86_400_000) });
  signedInAs('usr-ana', 'admin');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(sink, { recursive: true, force: true });
});

describe('members.invite', () => {
  it('with mail off, makes the invite and says it was not emailed', async () => {
    const created = await call<Created>(createInviteRoute, { email: 'Dana@Northwind.example', role: 'member' });

    expect(created).toMatchObject({ email: 'dana@northwind.example', delivery: { status: 'mail-off' } });
    // The sink keeps what would have been sent; nothing was delivered.
    expect((await readSink(sink)).map(m => m.delivered)).toEqual([false]);
  });

  it('with mail on, emails "Join Northwind on Vocion" from the admin, with the invite\'s link', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');

    const created = await call<Created>(createInviteRoute, { email: 'dana@northwind.example', role: 'member' });

    expect(created.delivery).toEqual({ status: 'sent' });

    const [mail] = await readSink(sink);

    expect(mail).toMatchObject({ to: ['dana@northwind.example'], subject: 'Join Northwind on Vocion', delivered: 'sink' });
    expect(mail!.text).toContain(`https://app.northwind.example/sign-up?invite=${created.token}`);
    expect(mail!.text).toContain('Ana Ortiz invited you');
  });

  it('past the admin\'s hourly allowance, still makes the invite and says why it was not emailed', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    for (let i = 0; i < RATE_LIMITS.inviteEmailPerUser.limit; i++) {
      await hit(RATE_LIMITS.inviteEmailPerUser, 'usr-ana');
    }

    const created = await call<Created>(createInviteRoute, { email: 'dana@northwind.example', role: 'member' });

    expect(created.delivery.status).toBe('failed');
    expect(created.delivery.reason).toMatch(/^Too many invite emails/);
    expect(await db.select().from(schema.inviteSchema).where(eq(schema.inviteSchema.id, created.id))).toHaveLength(1);
    expect(await readSink(sink)).toHaveLength(0);
  });

  it('is for admins only', async () => {
    signedInAs('usr-ana', 'member');

    await expect(call(createInviteRoute, { email: 'dana@northwind.example', role: 'member' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('members.resendInvite', () => {
  it('is refused with a sentence when this server sends no email', async () => {
    const created = await call<Created>(createInviteRoute, { email: 'dana@northwind.example', role: 'member' });

    await expect(call(resendInviteRoute, { inviteId: created.id }))
      .rejects
      .toMatchObject({ status: 400, message: 'This server sends no email. Copy the invite link and share it.' });
  });

  it('mails the invite again when mail is on', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    const created = await call<Created>(createInviteRoute, { email: 'dana@northwind.example', role: 'member' });

    await expect(call(resendInviteRoute, { inviteId: created.id })).resolves.toEqual({ delivery: { status: 'sent' } });

    const mails = await readSink(sink);

    expect(mails).toHaveLength(2);
    expect(mails.every(m => m.to[0] === 'dana@northwind.example')).toBe(true);
  });

  it('reaches only an invite in the admin\'s own Org', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');

    await expect(call(resendInviteRoute, { inviteId: 'inv-kestrel' })).rejects.toMatchObject({ status: 400 });
    expect(await readSink(sink)).toHaveLength(0);
  });
});

describe('members.inviteDelivery', () => {
  it('says whether invites are emailed', async () => {
    await expect(call(inviteDeliveryRoute)).resolves.toEqual({ emails: false });

    vi.stubEnv('VOCION_MAIL_ENABLED', '1');

    await expect(call(inviteDeliveryRoute)).resolves.toEqual({ emails: true });
  });
});
