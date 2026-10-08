/**
 * The invite dialog says what became of the invite: emailed (with the link to
 * copy too), a link to share when the server sends no mail, or why the mail
 * did not go — the link is the fallback every time. Fixtures are fictional.
 */
import type { CreatedInvite } from './InviteDialog';
import type { InviteDelivery } from '@/services/InviteMail';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import en from '@/locales/en.json';
import { InviteDialog } from './InviteDialog';

function created(delivery: InviteDelivery): CreatedInvite {
  return {
    id: 'inv-casey',
    email: 'casey@northwind.example',
    role: 'member',
    token: 'tok-casey',
    createdAt: new Date('2026-10-08T12:00:00Z'),
    expiresAt: new Date('2026-10-22T12:00:00Z'),
    expired: false,
    invitedBy: null,
    delivery,
  };
}

async function openDialog(emails: boolean, delivery: InviteDelivery) {
  const onInvite = vi.fn(async () => created(delivery));
  await render(
    <NextIntlClientProvider locale="en" messages={en}>
      <InviteDialog open pending={false} error={null} emails={emails} onOpenChange={() => {}} onInvite={onInvite} />
    </NextIntlClientProvider>,
  );
  return onInvite;
}

async function invite(button: string) {
  await userEvent.fill(page.getByLabelText('Email'), 'casey@northwind.example');
  await userEvent.click(page.getByRole('button', { name: button }));
}

describe('InviteDialog — mail on', () => {
  it('says the invite is emailed, sends it, and still shows the link to copy', async () => {
    const onInvite = await openDialog(true, { status: 'sent' });

    await expect.element(page.getByText(/We email them a link to join/)).toBeVisible();

    await invite('Send invite');

    expect(onInvite).toHaveBeenCalledWith('casey@northwind.example', 'member');
    await expect.element(page.getByText('Emailed to casey@northwind.example. The link works too:')).toBeVisible();
    await expect.element(page.getByLabelText('Invite link')).toHaveValue(`${window.location.origin}/sign-up?invite=tok-casey`);
    await expect.element(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  });

  it('says why the mail did not go, and leaves the link to send by hand', async () => {
    await openDialog(true, { status: 'failed', reason: 'The email did not go. Copy the link and send it yourself.' });

    await invite('Send invite');

    await expect.element(page.getByText('Not emailed to casey@northwind.example.')).toBeVisible();
    await expect.element(page.getByText('The email did not go. Copy the link and send it yourself.')).toBeVisible();
    await expect.element(page.getByLabelText('Invite link')).toHaveValue(`${window.location.origin}/sign-up?invite=tok-casey`);
  });
});

describe('InviteDialog — mail off', () => {
  it('makes a link to share, and says no email is sent', async () => {
    await openDialog(false, { status: 'mail-off' });

    await expect.element(page.getByText(/This server sends no email/)).toBeVisible();

    await invite('Create link');

    await expect.element(page.getByText('Link for casey@northwind.example')).toBeVisible();
    await expect.element(page.getByText(/^Emailed to/)).not.toBeInTheDocument();
  });
});
