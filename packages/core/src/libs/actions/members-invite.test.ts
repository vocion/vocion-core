import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `members.invite` — inviting teammates from a setup card. The same invite the
 * Members page makes, refused for someone already in, allowed only to an
 * admin (read from the person who decided, never the agent that offered it),
 * and undone by withdrawing what nobody has used yet. Scoped to the
 * workspace's own Org. Delivered like the Members page's: mailed when mail is on.
 */

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { membersInviteAction } = await import('./members-invite');

const NORTHWIND = 'acct-inv-northwind';
const KESTREL = 'acct-inv-kestrel';
const SUPPORT = 'proj-inv-support';
const DANA = 'usr-inv-dana'; // admin
const OMAR = 'usr-inv-omar'; // member

async function invitesOf(accountId: string) {
  return db.select().from(inviteSchema).where(eq(inviteSchema.accountId, accountId));
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-inv' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-inv' },
  ]);
  await db.insert(projectSchema).values({ id: SUPPORT, accountId: NORTHWIND, slug: 'support', name: 'Northwind Support' });
  await db.insert(userSchema).values([
    { id: DANA, email: 'dana@northwind.example' },
    { id: OMAR, email: 'omar@northwind.example' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: NORTHWIND, userId: DANA, role: 'admin' },
    { accountId: NORTHWIND, userId: OMAR, role: 'member' },
  ]);
});

beforeEach(async () => {
  await db.delete(inviteSchema);
});

describe('members.invite', () => {
  it('normalises the addresses and refuses a card for people who are all already in', async () => {
    const parsed = membersInviteAction.inputSchema.parse({ emails: [' Ana@Northwind.example '] });

    expect(parsed).toEqual({ emails: ['ana@northwind.example'], role: 'member' });
    expect(membersInviteAction.inputSchema.safeParse({ emails: ['not-an-address'] }).success).toBe(false);
    expect(await membersInviteAction.precheck!({ orgId: SUPPORT }, { emails: ['omar@northwind.example'], role: 'member' })).toContain('already in this workspace');
    expect(await membersInviteAction.precheck!({ orgId: SUPPORT }, { emails: ['omar@northwind.example', 'ana@northwind.example'], role: 'member' })).toBeUndefined();
  });

  it('invites into the workspace\'s own Org, skips who is already in, and Undo withdraws what nobody used', async () => {
    const result = await membersInviteAction.execute({ orgId: SUPPORT, reviewedBy: DANA }, { emails: ['ana@northwind.example', 'omar@northwind.example', 'ben@northwind.example'], role: 'member' });

    expect(result).toMatchObject({ invited: true, skipped: [{ email: 'omar@northwind.example', reason: 'already a member' }], membersHref: '/dashboard/members' });
    expect((await invitesOf(NORTHWIND)).map(i => i.email).sort()).toEqual(['ana@northwind.example', 'ben@northwind.example']);
    expect((await invitesOf(NORTHWIND)).every(i => i.invitedBy === DANA)).toBe(true);
    expect(await invitesOf(KESTREL)).toHaveLength(0);

    // Ana joins before the Undo: hers is a person who joined, not Undo's to take back.
    await db.update(inviteSchema).set({ acceptedAt: new Date() }).where(eq(inviteSchema.email, 'ana@northwind.example'));
    const undone = await membersInviteAction.undo!({ orgId: SUPPORT, reviewedBy: DANA }, { emails: [], role: 'member' }, result);

    expect(undone).toMatchObject({ undone: true, withdrawn: ['ben@northwind.example'], kept: 1 });
    expect((await invitesOf(NORTHWIND)).map(i => i.email)).toEqual(['ana@northwind.example']);
  });

  it('only an admin can invite, whoever offered the card', async () => {
    await expect(membersInviteAction.execute({ orgId: SUPPORT, reviewedBy: OMAR }, { emails: ['ana@northwind.example'], role: 'member' })).rejects.toThrow('Only an admin can invite people');
    await expect(membersInviteAction.execute({ orgId: SUPPORT, invokedBy: 'agent:workspace-lead' }, { emails: ['ana@northwind.example'], role: 'member' })).rejects.toThrow('Only an admin can invite people');
    expect(await invitesOf(NORTHWIND)).toHaveLength(0);
  });

  it('says, per invite, that its email was not sent and why, when this server sends no mail', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', '');
    try {
      const result = await membersInviteAction.execute({ orgId: SUPPORT, reviewedBy: DANA }, { emails: ['ana@northwind.example'], role: 'member' });

      expect(result.invites).toEqual([expect.objectContaining({ email: 'ana@northwind.example', emailed: false, emailNotSentReason: 'This server does not send email' })]);
      expect(result.note).toBe('Email not sent to ana@northwind.example: This server does not send email. Copy the link from Members.');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('mails each invite when this server sends mail, as the Members page does', async () => {
    const sink = await mkdtemp(join(tmpdir(), 'vocion-members-invite-action-'));
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.northwind.example');
    vi.stubEnv('VOCION_RATE_LIMIT', 'off');
    try {
      const result = await membersInviteAction.execute({ orgId: SUPPORT, reviewedBy: DANA }, { emails: ['ana@northwind.example'], role: 'member' });

      expect(result.invites).toEqual([expect.objectContaining({ email: 'ana@northwind.example', emailed: true })]);
      expect(result.note).toBe('Email sent to ana@northwind.example.');

      const { readSink } = await import('@/libs/mail/sink');
      const [mail] = await readSink(sink);

      expect(mail).toMatchObject({ to: ['ana@northwind.example'], subject: 'Join Northwind on Vocion', delivered: 'sink' });
    } finally {
      vi.unstubAllEnvs();
      await rm(sink, { recursive: true, force: true });
    }
  });
});
