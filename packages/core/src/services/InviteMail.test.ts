/**
 * Invites by email (real rows, PGlite; mail through the dev mail sink, never
 * a provider).
 *
 * Pinned: the mail says "Join Northwind on Vocion", who sent it, its one
 * button and when it expires, and escapes whatever an admin typed; with mail
 * off nothing is sent (the sink, when on, keeps what would have been); with
 * mail on the invitee is mailed a link on the deployment's own address; an
 * expired invite, or a production server that does not know its address, is
 * a failure with a sentence for the admin, never a thrown error.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const schema = await import('@/models/Schema');
const { readSink } = await import('@/libs/mail/sink');
const { inviteMail, sendInviteEmail } = await import('./InviteMail');

const DAY = 24 * 60 * 60 * 1000;
const EXPIRES = new Date('2026-10-22T12:00:00Z');
const LINK = 'https://app.northwind.example/sign-up?invite=tok-dana';

let sink: string;

beforeEach(async () => {
  sink = await mkdtemp(join(tmpdir(), 'vocion-invite-mail-'));
  for (const key of ['VOCION_MAIL_ENABLED', 'RESEND_API_KEY', 'VOCION_MAIL_FROM', 'VOCION_MAIL_SINK_DIR', 'AUTH_URL']) {
    vi.stubEnv(key, '');
  }
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.northwind.example');
  vi.stubEnv('NODE_ENV', 'test');
  await db.delete(schema.inviteSchema);
  await db.delete(schema.accountMembershipSchema);
  await db.delete(schema.tenantAccountSchema);
  await db.delete(schema.userSchema);
  await db.insert(schema.tenantAccountSchema).values([
    { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
  ]);
  await db.insert(schema.userSchema).values({ id: 'usr-sam', email: 'sam@northwind.example', name: 'Sam Rivera' });
  await db.insert(schema.inviteSchema).values([
    { id: 'inv-dana', accountId: 'acct-northwind', email: 'dana@northwind.example', role: 'member', token: 'tok-dana', invitedBy: 'usr-sam', expiresAt: new Date(Date.now() + 14 * DAY) },
    { id: 'inv-old', accountId: 'acct-northwind', email: 'lee@northwind.example', role: 'member', token: 'tok-old', invitedBy: 'usr-sam', expiresAt: new Date(Date.now() - DAY) },
  ]);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(sink, { recursive: true, force: true });
});

describe('inviteMail', () => {
  const mail = inviteMail({ orgName: 'Northwind', inviterName: 'Sam Rivera', role: 'member', link: LINK, expiresAt: EXPIRES });

  it('says who asked, into which Org, as what', () => {
    expect(mail.subject).toBe('Join Northwind on Vocion');
    expect(mail.text).toContain('Sam Rivera invited you to join Northwind on Vocion as a member.');
    expect(inviteMail({ orgName: 'Northwind', inviterName: null, role: 'admin', link: LINK, expiresAt: EXPIRES }).text)
      .toContain('You are invited to join Northwind on Vocion as an admin.');
  });

  it('has one button, to the invite link, and the link written out for a client that hides buttons', () => {
    expect(mail.text).toContain(`Join Northwind: ${LINK}`);
    // The button, and the same link written out under it — one place to go.
    expect(mail.html.match(/<a /g)).toHaveLength(2);
    expect(mail.html.match(/display:inline-block/g)).toHaveLength(1);
    expect(mail.html).toContain(`href="${LINK}"`);
  });

  it('says when the link stops working', () => {
    expect(mail.text).toContain('until October 22, 2026');
  });

  it('escapes what an admin typed', () => {
    const hostile = inviteMail({ orgName: 'Acme <script>alert(1)</script>', inviterName: 'Eve "<b>"', role: 'member', link: LINK, expiresAt: EXPIRES });

    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).not.toContain('<b>');
    expect(hostile.html).toContain('Acme &lt;script&gt;');
    expect(hostile.subject).toBe('Join Acme <script>alert(1)</script> on Vocion');
  });
});

describe('sendInviteEmail', () => {
  it('sends nothing with mail off', async () => {
    await expect(sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-dana', requestOrigin: null })).resolves.toEqual({ status: 'mail-off' });
  });

  it('with mail off and the sink on, keeps what would have been sent', async () => {
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);

    await expect(sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-dana', requestOrigin: null })).resolves.toEqual({ status: 'mail-off' });

    const [kept] = await readSink(sink);

    expect(kept).toMatchObject({ to: ['dana@northwind.example'], subject: 'Join Northwind on Vocion', delivered: false, tags: { kind: 'invite' } });
  });

  it('with mail on, mails the invitee a link on the deployment\'s own address', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);

    await expect(sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-dana', requestOrigin: 'https://evil.example' })).resolves.toEqual({ status: 'sent' });

    const mails = await readSink(sink);

    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: ['dana@northwind.example'], delivered: 'sink' });
    expect(mails[0]!.text).toContain('https://app.northwind.example/sign-up?invite=tok-dana');
    expect(mails[0]!.text).toContain('Sam Rivera invited you');
  });

  it('refuses to mail an expired invite, saying to re-invite', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);

    await expect(sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-old', requestOrigin: null }))
      .resolves
      .toEqual({ status: 'failed', reason: 'That invite has expired. Re-invite to make a fresh one.' });
    expect(await readSink(sink)).toHaveLength(0);
  });

  it('refuses an invite from another Org, or one that is gone', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);

    await expect(sendInviteEmail({ accountId: 'acct-kestrel', inviteId: 'inv-dana', requestOrigin: null })).resolves.toMatchObject({ status: 'failed' });
    await expect(sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-gone', requestOrigin: null })).resolves.toMatchObject({ status: 'failed' });
    expect(await readSink(sink)).toHaveLength(0);
  });

  it('in production, never builds the link from the request — no configured address, no mail', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('NODE_ENV', 'production');

    const delivery = await sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-dana', requestOrigin: 'https://evil.example' });

    expect(delivery).toMatchObject({ status: 'failed' });
    expect(delivery.status === 'failed' && delivery.reason).toMatch(/NEXT_PUBLIC_APP_URL/);
    expect(await readSink(sink)).toHaveLength(0);
  });

  it('outside production, falls back to the admin\'s own address when none is configured', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    await expect(sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-dana', requestOrigin: 'http://localhost:3000' })).resolves.toEqual({ status: 'sent' });

    const [mail] = await readSink(sink);

    expect(mail!.text).toContain('http://localhost:3000/sign-up?invite=tok-dana');
  });
});
