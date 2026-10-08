/**
 * Invites on the People lane: somebody invited and not yet joined is a row
 * beside the people who have, counted in the lane's tab and its summary,
 * narrowed by a Status facet, and carrying the verbs the invite dialog used to
 * hold — copy the link, revoke it, re-invite once it has expired.
 *
 * The screen's own reads are mocked; what is under test is what it draws from
 * them. Fixtures are fictional.
 */
import type { AccessOverview } from '@/services/GroupService';
import type { PendingInvite, TeamMember } from '@/services/MembersService';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import en from '@/locales/en.json';

vi.mock('@/libs/Orpc', () => ({
  client: {
    groups: { overview: vi.fn() },
    members: { list: vi.fn(), invites: vi.fn(), invite: vi.fn(), revokeInvite: vi.fn(), inviteDelivery: vi.fn(), resendInvite: vi.fn() },
  },
}));

const { client } = await import('@/libs/Orpc');
const { MembersScreen } = await import('./MembersScreen');

const OVERVIEW: AccessOverview = {
  enforced: true,
  workspaces: [{ id: 'p-rev', slug: 'revenue', name: 'Revenue Team', kind: 'shared' }],
  groups: [{
    id: 'g-rev',
    slug: 'revops',
    name: 'RevOps',
    description: null,
    managedFrom: 'ui',
    grants: [{ projectId: 'p-rev', slug: 'revenue', name: 'Revenue Team', role: 'member' }],
    members: [{ userId: 'u-alex', name: 'Alex Morrow', email: 'alex@northwind.example' }],
  }],
  people: [
    {
      userId: 'u-brit',
      name: 'Brit Nakamura',
      email: 'brit@northwind.example',
      accountRole: 'admin',
      groups: [],
      reaches: [{ projectId: 'p-rev', slug: 'revenue', name: 'Revenue Team', role: 'admin', via: 'account-admin' }],
    },
    {
      userId: 'u-alex',
      name: 'Alex Morrow',
      email: 'alex@northwind.example',
      accountRole: 'member',
      groups: ['revops'],
      reaches: [{ projectId: 'p-rev', slug: 'revenue', name: 'Revenue Team', role: 'member', via: 'group' }],
    },
  ],
};

const MEMBERS: TeamMember[] = [
  { userId: 'u-brit', name: 'Brit Nakamura', email: 'brit@northwind.example', role: 'admin', joinedAt: new Date('2026-08-01T00:00:00Z') },
  { userId: 'u-alex', name: 'Alex Morrow', email: 'alex@northwind.example', role: 'member', joinedAt: new Date('2026-09-15T00:00:00Z') },
];

const PENDING: PendingInvite = {
  id: 'inv-casey',
  email: 'casey@kestrel.example',
  role: 'member',
  token: 'tok-casey',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  expiresAt: new Date('2099-10-15T00:00:00Z'),
  expired: false,
  invitedBy: { userId: 'u-brit', name: 'Brit Nakamura', email: 'brit@northwind.example' },
};

const EXPIRED: PendingInvite = {
  id: 'inv-devon',
  email: 'devon@contoso.example',
  role: 'admin',
  token: 'tok-devon',
  createdAt: new Date('2026-09-06T00:00:00Z'),
  expiresAt: new Date('2026-09-20T00:00:00Z'),
  expired: true,
  invitedBy: { userId: 'u-brit', name: 'Brit Nakamura', email: 'brit@northwind.example' },
};

async function renderScreen(isAdmin = true) {
  await render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MembersScreen isAdmin={isAdmin} currentUserId="u-brit" />
    </NextIntlClientProvider>,
  );

  await expect.element(page.getByText('Alex Morrow')).toBeVisible();
}

function summary() {
  return page.getByText(/\d+ (person|people|invited)/);
}

beforeEach(() => {
  // The list's lane and facets live in the URL; start each test on a clean one.
  window.history.replaceState(null, '', window.location.pathname);
  vi.mocked(client.groups.overview).mockReset().mockResolvedValue(OVERVIEW as never);
  vi.mocked(client.members.list).mockReset().mockResolvedValue(MEMBERS as never);
  vi.mocked(client.members.invites).mockReset().mockResolvedValue([PENDING, EXPIRED] as never);
  vi.mocked(client.members.invite).mockReset().mockResolvedValue({ ...EXPIRED, id: 'inv-devon-2', expired: false } as never);
  vi.mocked(client.members.revokeInvite).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(client.members.inviteDelivery).mockReset().mockResolvedValue({ emails: false } as never);
  vi.mocked(client.members.resendInvite).mockReset().mockResolvedValue({ delivery: { status: 'sent' } } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('invites on the People lane', () => {
  it('shows each open invite as a row, counted in the tab and the summary', async () => {
    await renderScreen();

    const row = page.getByTestId('invite-row-inv-casey');

    await expect.element(row).toHaveTextContent('casey@kestrel.example');
    await expect.element(row).toHaveTextContent('Invited Oct 1 by Brit Nakamura');
    await expect.element(row.getByTestId('invite-expiry')).toHaveTextContent('expires Oct 15');
    await expect.element(row.getByTestId('invite-state')).toHaveTextContent('Invited');
    await expect.element(page.getByRole('button', { name: /^People\s*4$/ })).toBeVisible();
    await expect.element(summary()).toHaveTextContent('2 people · 2 invited');
  });

  it('marks an expired invite Expired, and offers Re-invite rather than a dead link', async () => {
    await renderScreen();

    const row = page.getByTestId('invite-row-inv-devon');

    await expect.element(row.getByTestId('invite-state')).toHaveTextContent('Expired');
    await expect.element(row.getByTestId('invite-expiry')).toHaveTextContent('expired Sep 20');

    await userEvent.click(page.getByRole('button', { name: 'Actions for the invite to devon@contoso.example' }));

    await expect.element(page.getByRole('menuitem', { name: 'Copy invite link' })).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('menuitem', { name: 'Re-invite' }));

    // A fresh link for the same address and role.
    await vi.waitFor(() => expect(client.members.invite).toHaveBeenCalledWith({ email: 'devon@contoso.example', role: 'admin' }));
  });

  it('narrows to the people who have joined, or to the invites, by Status', async () => {
    await renderScreen();

    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Status' }), 'invited');

    await expect.element(summary()).toHaveTextContent('2 invited');
    await expect.element(page.getByText('Alex Morrow')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('invite-row-inv-casey')).toBeVisible();

    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Status' }), 'active');

    await expect.element(summary()).toHaveTextContent('2 people');
    await expect.element(page.getByTestId('invite-row-inv-casey')).not.toBeInTheDocument();
  });

  it('leaves invites out of a group filter, since nobody invited is in a group yet', async () => {
    await renderScreen();

    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Group' }), 'revops');

    await expect.element(summary()).toHaveTextContent('1 person');
    await expect.element(page.getByTestId('invite-row-inv-casey')).not.toBeInTheDocument();
  });

  it('copies the invite link from the row', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    });
    await renderScreen();

    await userEvent.click(page.getByRole('button', { name: 'Actions for the invite to casey@kestrel.example' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Copy invite link' }));

    await expect.element(page.getByRole('menuitem', { name: 'Copied' })).toBeVisible();
    expect(written).toEqual([`${window.location.origin}/sign-up?invite=tok-casey`]);
  });

  it('revokes only once the admin confirms, and the row goes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderScreen();

    await userEvent.click(page.getByRole('button', { name: 'Actions for the invite to casey@kestrel.example' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Revoke invite' }));

    expect(confirm).toHaveBeenCalledWith('Revoke the invite for casey@kestrel.example? Their link stops working.');
    expect(client.members.revokeInvite).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    vi.mocked(client.members.invites).mockResolvedValue([EXPIRED] as never);
    await userEvent.click(page.getByRole('button', { name: 'Actions for the invite to casey@kestrel.example' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Revoke invite' }));

    await vi.waitFor(() => expect(client.members.revokeInvite).toHaveBeenCalledWith({ inviteId: 'inv-casey' }));

    await expect.element(page.getByTestId('invite-row-inv-casey')).not.toBeInTheDocument();
    await expect.element(summary()).toHaveTextContent('2 people · 1 invited');
  });

  it('never shows an invite as a second row for somebody already in the Org', async () => {
    vi.mocked(client.members.invites).mockResolvedValue([{ ...PENDING, id: 'inv-alex', email: 'alex@northwind.example' }] as never);
    await renderScreen();

    await expect.element(page.getByTestId('invite-row-inv-alex')).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /^People\s*2$/ })).toBeVisible();
    await expect.element(summary()).toHaveTextContent('2 people');
  });

  it('keeps the invite dialog to making links; the pending ones live on the list', async () => {
    await renderScreen();

    await userEvent.click(page.getByRole('button', { name: 'Invite member' }));

    await expect.element(page.getByTestId('invite-dialog')).toBeVisible();
    await expect.element(page.getByTestId('invite-dialog').getByText('casey@kestrel.example')).not.toBeInTheDocument();
  });
});

describe('invite emails', () => {
  it('offers no "Resend email" on a server that sends no mail', async () => {
    await renderScreen();

    await userEvent.click(page.getByRole('button', { name: 'Actions for the invite to casey@kestrel.example' }));

    await expect.element(page.getByRole('menuitem', { name: 'Copy invite link' })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: 'Resend email' })).not.toBeInTheDocument();
  });

  it('mails a pending invite again from its row when mail is on, and says so', async () => {
    vi.mocked(client.members.inviteDelivery).mockResolvedValue({ emails: true } as never);
    await renderScreen();

    await userEvent.click(page.getByRole('button', { name: 'Actions for the invite to casey@kestrel.example' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Resend email' }));

    await vi.waitFor(() => expect(client.members.resendInvite).toHaveBeenCalledWith({ inviteId: 'inv-casey' }));

    await expect.element(page.getByRole('status').filter({ hasText: 'Emailed the invite to casey@kestrel.example again.' })).toBeVisible();
  });

  it('says the dialog emails the invite when mail is on', async () => {
    vi.mocked(client.members.inviteDelivery).mockResolvedValue({ emails: true } as never);
    await renderScreen();

    await userEvent.click(page.getByRole('button', { name: 'Invite member' }));

    await expect.element(page.getByTestId('invite-dialog').getByText(/We email them a link to join/)).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Send invite' })).toBeVisible();
  });
});

describe('a member who is not an admin', () => {
  it('reads no invites and sees no Status facet', async () => {
    await renderScreen(false);

    expect(client.members.invites).not.toHaveBeenCalled();
    expect(client.members.inviteDelivery).not.toHaveBeenCalled();
    await expect.element(page.getByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    await expect.element(summary()).toHaveTextContent('2 people');
  });
});
