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
    await expect.element(page.getByText(/invited to the Contoso Org as an admin\. You'll join with the login you're using now, sam@example\.com/)).toBeInTheDocument();
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

  it('shows the failure and lets them try again when the request never reaches the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await render(<JoinAccountCard inviteToken="tok" invite={{ accountName: 'Contoso', role: 'member', standing: 'open', openPath: null }} signedInEmail="sam@example.com" />);
      await page.getByRole('button', { name: 'Join Contoso' }).click();

      await expect.element(page.getByRole('alert')).toHaveTextContent('Could not reach the server.');
      await expect.element(page.getByRole('button', { name: 'Join Contoso' })).toBeEnabled();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('offers to sign in again when the session ran out before they clicked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Sign in to accept this invite.' }, { status: 401 })));
    try {
      await render(<JoinAccountCard inviteToken="tok 1" invite={{ accountName: 'Contoso', role: 'member', standing: 'open', openPath: null }} signedInEmail="sam@example.com" />);
      await page.getByRole('button', { name: 'Join Contoso' }).click();

      await expect.element(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/sign-in?callbackUrl=%2Fsign-up%3Finvite%3Dtok%25201');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers sign-out instead of joining when the invite is for another email', async () => {
    await render(<JoinAccountCard inviteToken="tok" invite={{ accountName: 'Contoso', role: 'member', standing: 'other-email', openPath: null }} signedInEmail="sam@example.com" />);

    await expect.element(page.getByRole('heading', { name: 'This invite is for a different email' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Sign out and continue' })).toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Join Contoso' }).elements()).toHaveLength(0);
  });

  it('opens the account for someone already in it', async () => {
    await render(<JoinAccountCard inviteToken="tok" invite={{ accountName: 'Contoso', role: 'member', standing: 'member', openPath: '/w/sales/dashboard?account=contoso' }} signedInEmail="sam@example.com" />);

    await expect.element(page.getByRole('link', { name: 'Open Contoso' })).toHaveAttribute('href', '/w/sales/dashboard?account=contoso');
    expect(page.getByRole('button', { name: 'Join Contoso' }).elements()).toHaveLength(0);
  });

  it('does not offer to open an account they hold no workspace in, since that would land them in their other account', async () => {
    await render(<JoinAccountCard inviteToken="tok" invite={{ accountName: 'Contoso', role: 'member', standing: 'member', openPath: null }} signedInEmail="sam@example.com" />);

    await expect.element(page.getByRole('heading', { name: 'You\'re already in Contoso' })).toBeInTheDocument();
    await expect.element(page.getByText('You don\'t have a workspace in the Contoso Org yet.', { exact: false })).toBeInTheDocument();
    expect(page.getByRole('link', { name: 'Open Contoso' }).elements()).toHaveLength(0);
  });

  it('offers nothing to accept on a used, expired or unknown invite', async () => {
    await render(<JoinAccountCard inviteToken="tok" invite={{ accountName: 'Contoso', role: 'member', standing: 'expired', openPath: null }} signedInEmail="sam@example.com" />);

    await expect.element(page.getByRole('heading', { name: 'Invite expired' })).toBeInTheDocument();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });
});
