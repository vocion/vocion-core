import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import messages from '@/locales/en.json';
import { SignInForm } from './SignInForm';

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

function renderForm(props: Partial<React.ComponentProps<typeof SignInForm>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SignInForm callbackUrl="/dashboard" error={null} hint={null} {...props} />
    </NextIntlClientProvider>,
  );
}

/**
 * The footer of the sign-in form is the only place the app talks about
 * getting an account, so it must agree with /api/signup, which accepts
 * nothing but an invite.
 */
describe('SignInForm sign-up footer', () => {
  it('tells visitors the instance is invite-only', async () => {
    await renderForm();

    await expect.element(page.getByText('This instance is invite-only — ask an admin for an invite link to join.')).toBeInTheDocument();
  });

  it('offers no sign-up link', async () => {
    await renderForm();

    expect(page.getByRole('link', { name: 'Create an account' }).elements()).toHaveLength(0);
  });
});

describe('SignInForm ways in', () => {
  it('links to forgot-password', async () => {
    await renderForm();

    await expect.element(page.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument();
  });

  it('offers Google only when the deployment configured it', async () => {
    await renderForm();

    expect(page.getByRole('button', { name: 'Continue with Google' }).elements()).toHaveLength(0);

    await renderForm({ google: true });

    await expect.element(page.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });

  it('says why a Google sign-in was refused', async () => {
    await renderForm({ error: 'AccessDenied', google: true });

    await expect.element(page.getByText('That Google account has no login here. Ask an admin to invite that email.')).toBeInTheDocument();
  });
});
