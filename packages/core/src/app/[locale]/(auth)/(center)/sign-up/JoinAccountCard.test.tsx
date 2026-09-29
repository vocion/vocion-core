import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { JoinAccountCard } from './JoinAccountCard';

vi.mock('next-auth/react', () => ({
  signOut: vi.fn(),
}));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

/**
 * The invite page for a signed-in person offers exactly one way forward, and
 * never a "Join" button the server would refuse (vocion-core#128).
 */
describe('JoinAccountCard', () => {
  it('offers to join an open invite, with the role it grants and the login it joins with', async () => {
    await render(<JoinAccountCard inviteToken="tok" invite={{ accountName: 'Contoso', role: 'admin', standing: 'open', openPath: null }} signedInEmail="sam@example.com" />);

    await expect.element(page.getByRole('button', { name: 'Join Contoso' })).toBeInTheDocument();
    await expect.element(page.getByText(/invited as an admin\. You'll join with sam@example\.com/)).toBeInTheDocument();
  });

  it('says they joined when there is no workspace to open yet, instead of dropping them back where they were', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, openPath: null })));
    try {
      await render(<JoinAccountCard inviteToken="tok" invite={{ accountName: 'Contoso', role: 'member', standing: 'open', openPath: null }} signedInEmail="sam@example.com" />);
      await page.getByRole('button', { name: 'Join Contoso' }).click();

      await expect.element(page.getByRole('heading', { name: 'You joined Contoso' })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers sign-out instead of joining when the invite is for another email', async () => {
    await render(<JoinAccountCard inviteToken="tok" invite={{ accountName: 'Contoso', role: 'member', standing: 'other-email', openPath: null }} signedInEmail="sam@example.com" />);

    await expect.element(page.getByRole('button', { name: 'Sign out and continue' })).toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Join Contoso' }).elements()).toHaveLength(0);
  });

  it('opens the account for someone already in it', async () => {
    await render(<JoinAccountCard inviteToken="tok" invite={{ accountName: 'Contoso', role: 'member', standing: 'member', openPath: '/w/sales/dashboard?account=contoso' }} signedInEmail="sam@example.com" />);

    await expect.element(page.getByRole('link', { name: 'Open Contoso' })).toHaveAttribute('href', '/w/sales/dashboard?account=contoso');
    expect(page.getByRole('button', { name: 'Join Contoso' }).elements()).toHaveLength(0);
  });

  it('offers nothing to accept on a used, expired or unknown invite', async () => {
    await render(<JoinAccountCard inviteToken="tok" invite={{ accountName: 'Contoso', role: 'member', standing: 'expired', openPath: null }} signedInEmail="sam@example.com" />);

    await expect.element(page.getByRole('heading', { name: 'Invite expired' })).toBeInTheDocument();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });
});
