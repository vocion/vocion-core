import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { SignUpForm } from './SignUpForm';

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

/**
 * Someone who already has a login opens an invite while signed out
 * (vocion-core#128). Signing up again is refused, so the form must send them
 * to sign in and bring them back to this invite, where they join on the login
 * they have.
 */
describe('SignUpForm with an invite, for someone who already has a login', () => {
  const INVITE = 'tok 1';
  const BACK_TO_INVITE = '/sign-in?callbackUrl=%2Fsign-up%3Finvite%3Dtok%25201';

  it('answers "you already have a login" with a sign-in link that returns to the invite', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { error: 'You already have a login with this email. Sign in to accept the invite.', code: 'EXISTING_USER' },
      { status: 409 },
    )));
    try {
      await render(<SignUpForm inviteToken={INVITE} />);
      await page.getByLabelText('Your name').fill('Sam');
      await page.getByLabelText('Email').fill('sam@example.com');
      await page.getByLabelText('Password').fill('a-long-password');
      await page.getByRole('button', { name: 'Accept invite + sign in' }).click();

      const alert = page.getByRole('alert');

      await expect.element(alert).toHaveTextContent('You already have a login with this email.');
      await expect.element(alert.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', BACK_TO_INVITE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows any other refusal without the sign-in link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'This invite has expired.' }, { status: 410 })));
    try {
      await render(<SignUpForm inviteToken={INVITE} />);
      await page.getByLabelText('Your name').fill('Sam');
      await page.getByLabelText('Email').fill('sam@example.com');
      await page.getByLabelText('Password').fill('a-long-password');
      await page.getByRole('button', { name: 'Accept invite + sign in' }).click();

      await expect.element(page.getByRole('alert')).toHaveTextContent('This invite has expired.');
      expect(page.getByRole('alert').getByRole('link').elements()).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('points the "Already have a login?" link back to the invite too', async () => {
    await render(<SignUpForm inviteToken={INVITE} />);

    await expect.element(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', BACK_TO_INVITE);
  });
});
