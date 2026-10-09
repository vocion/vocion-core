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
vi.mock('@/libs/Logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { db } = await import('@/libs/DB');
const schema = await import('@/models/Schema');
const { readSink } = await import('@/libs/mail/sink');
const { logger } = await import('@/libs/Logger');
const { deliverInvite, inviteMail, sendInviteEmail } = await import('./InviteMail');

/**
 * The warning a non-send logs, once the fire-and-forget log has landed.
 * @param reason - The reason it must carry.
 */
async function warned(reason: string): Promise<void> {
  await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(`invite email not sent: ${reason}`, expect.objectContaining({ reason })));
}

const DAY = 24 * 60 * 60 * 1000;
const EXPIRES = new Date('2026-10-22T12:00:00Z');
const LINK = 'https://app.northwind.example/sign-up?invite=tok-dana';

let sink: string;

beforeEach(async () => {
  vi.mocked(logger.warn).mockClear();
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
  it('sends nothing with mail off, and says so in the logs and to the admin', async () => {
    await expect(sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-dana', requestOrigin: null })).resolves.toEqual({ status: 'mail-off', reason: 'This server does not send email' });

    await warned('This server does not send email');
  });

  it('with mail off and the sink on, keeps what would have been sent', async () => {
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);

    await expect(sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-dana', requestOrigin: null })).resolves.toEqual({ status: 'mail-off', reason: 'This server does not send email' });

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
      .toEqual({ status: 'failed', reason: 'That invite has expired; re-invite to make a fresh one' });
    expect(await readSink(sink)).toHaveLength(0);

    await warned('That invite has expired; re-invite to make a fresh one');
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

    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/^invite email not sent: .*NEXT_PUBLIC_APP_URL/), expect.objectContaining({ hint: expect.stringMatching(/NEXT_PUBLIC_APP_URL/) })));
  });

  it('outside production, falls back to the admin\'s own address when none is configured', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    await expect(sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-dana', requestOrigin: 'http://localhost:3000' })).resolves.toEqual({ status: 'sent' });

    const [mail] = await readSink(sink);

    expect(mail!.text).toContain('http://localhost:3000/sign-up?invite=tok-dana');
  });

  it('with mail on but no sender, names the missing setting rather than claiming a send', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');

    const delivery = await sendInviteEmail({ accountId: 'acct-northwind', inviteId: 'inv-dana', requestOrigin: null });

    expect(delivery).toEqual({ status: 'failed', reason: 'Outbound mail is enabled but RESEND_API_KEY and VOCION_MAIL_FROM are not set' });

    await warned('Outbound mail is enabled but RESEND_API_KEY and VOCION_MAIL_FROM are not set');
  });
});

describe('deliverInvite', () => {
  it('mails the invite with mail on, and logs the send', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);
    vi.stubEnv('VOCION_RATE_LIMIT', 'off');

    await expect(deliverInvite({ accountId: 'acct-northwind', inviteId: 'inv-dana', email: 'dana@northwind.example', invitedBy: 'usr-sam', requestOrigin: null }))
      .resolves
      .toEqual({ status: 'sent' });
    expect(await readSink(sink)).toHaveLength(1);

    await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith('invite email sent', expect.objectContaining({ inviteId: 'inv-dana' })));
  });

  it('with mail off, returns the reason and warns, and the invite stands', async () => {
    await expect(deliverInvite({ accountId: 'acct-northwind', inviteId: 'inv-dana', email: 'dana@northwind.example', invitedBy: 'usr-sam', requestOrigin: null }))
      .resolves
      .toEqual({ status: 'mail-off', reason: 'This server does not send email' });

    await warned('This server does not send email');
  });
});
