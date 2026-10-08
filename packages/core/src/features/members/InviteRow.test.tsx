/**
 * An invite's row offers "Resend email" exactly when the server mails invites
 * and the link still works; an expired one offers Re-invite instead.
 * Fixtures are fictional.
 */
import type { InviteRow as InviteRowData } from './access';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import en from '@/locales/en.json';
import { InviteRow } from './InviteRow';

const PENDING: InviteRowData = {
  inviteId: 'inv-casey',
  email: 'casey@kestrel.example',
  accountRole: 'member',
  token: 'tok-casey',
  invitedAt: new Date('2026-10-01T00:00:00Z'),
  invitedBy: 'Brit Nakamura',
  expiresAt: new Date('2099-10-15T00:00:00Z'),
  expired: false,
};

async function renderRow(invite: InviteRowData, onResend?: (invite: InviteRowData) => void) {
  await render(
    <NextIntlClientProvider locale="en" messages={en}>
      <InviteRow invite={invite} pending={false} onRevoke={() => {}} onReinvite={() => {}} onResend={onResend} />
    </NextIntlClientProvider>,
  );
  await userEvent.click(page.getByRole('button', { name: `Actions for the invite to ${invite.email}` }));
}

describe('InviteRow — Resend email', () => {
  it('mails a live invite again when the server sends mail', async () => {
    const onResend = vi.fn();
    await renderRow(PENDING, onResend);

    await userEvent.click(page.getByRole('menuitem', { name: 'Resend email' }));

    expect(onResend).toHaveBeenCalledWith(PENDING);
  });

  it('is not offered when the server sends no mail — Copy is', async () => {
    await renderRow(PENDING);

    await expect.element(page.getByRole('menuitem', { name: 'Copy invite link' })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: 'Resend email' })).not.toBeInTheDocument();
  });

  it('is not offered for an expired invite, whose link no longer works', async () => {
    await renderRow({ ...PENDING, expired: true, expiresAt: new Date('2026-09-20T00:00:00Z') }, vi.fn());

    await expect.element(page.getByRole('menuitem', { name: 'Re-invite' })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: 'Resend email' })).not.toBeInTheDocument();
  });
});
