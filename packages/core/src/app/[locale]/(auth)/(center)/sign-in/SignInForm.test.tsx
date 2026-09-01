import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { SignInForm } from './SignInForm';

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

/**
 * The footer of the sign-in form is the only entry point users have to
 * sign-up, so it must agree with what /api/signup will actually allow:
 * self-service registration on an empty instance, invite-only afterwards.
 */
describe('SignInForm sign-up footer', () => {
  it('offers account creation while the instance has no users', async () => {
    await render(<SignInForm callbackUrl="/dashboard" error={null} hint={null} canSelfSignUp />);

    await expect.element(page.getByRole('link', { name: 'Create an account' })).toBeInTheDocument();
  });

  it('says the instance is invite-only once a user exists', async () => {
    await render(<SignInForm callbackUrl="/dashboard" error={null} hint={null} canSelfSignUp={false} />);

    await expect.element(page.getByText('This instance is invite-only — ask an admin for an invite link to join.')).toBeInTheDocument();
    expect(page.getByRole('link', { name: 'Create an account' }).elements()).toHaveLength(0);
  });
});
