import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import messages from '@/locales/en.json';
import { InvitationsList } from './InvitationsSection';

/**
 * The profile's "Invitations": one Join per Org that asked, none where the
 * server cannot hold a second Org (the reason instead), and a refused join
 * says why under its row.
 */
const KESTREL = { token: 'tok-kestrel', orgName: 'Kestrel Capital', role: 'member' as const, expiresAt: new Date('2026-10-22T12:00:00Z'), problem: null };

function renderList(props: Partial<React.ComponentProps<typeof InvitationsList>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <InvitationsList invitations={[KESTREL]} onJoin={async () => null} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('InvitationsList', () => {
  it('joins an Org in one click', async () => {
    const onJoin = vi.fn(async () => null);
    await renderList({ onJoin });

    await expect.element(page.getByText('Invited as a member · expires Oct 22, 2026')).toBeInTheDocument();

    await page.getByRole('button', { name: 'Join Kestrel Capital' }).click();

    expect(onJoin).toHaveBeenCalledWith('tok-kestrel');
  });

  it('offers no button where the server cannot hold a second Org, and says why', async () => {
    await renderList({ invitations: [{ ...KESTREL, problem: 'This Vocion server runs a single Org.' }] });

    await expect.element(page.getByRole('alert')).toHaveTextContent('This Vocion server runs a single Org.');
    expect(page.getByRole('button', { name: /Join/ }).elements()).toHaveLength(0);
  });

  it('says why a join was refused', async () => {
    await renderList({ onJoin: async () => 'Invalid invite token.' });

    await page.getByRole('button', { name: 'Join Kestrel Capital' }).click();

    await expect.element(page.getByRole('alert')).toHaveTextContent('Invalid invite token.');
  });
});
