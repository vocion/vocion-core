import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { SignInForm } from './SignInForm';

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

/**
 * The footer of the sign-in form is the only place the app talks about
 * getting an account, so it must agree with /api/signup, which accepts
 * nothing but an invite.
 */
describe('SignInForm sign-up footer', () => {
  it('tells visitors the instance is invite-only', async () => {
    await render(<SignInForm callbackUrl="/dashboard" error={null} hint={null} />);

    await expect.element(page.getByText('This instance is invite-only — ask an admin for an invite link to join.')).toBeInTheDocument();
  });

  it('offers no sign-up link', async () => {
    await render(<SignInForm callbackUrl="/dashboard" error={null} hint={null} />);

    expect(page.getByRole('link', { name: 'Create an account' }).elements()).toHaveLength(0);
  });
});
