import { signIn } from 'next-auth/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { SignInForm } from './SignInForm';

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

const PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft-entra-id', label: 'Microsoft' },
];

beforeEach(() => {
  vi.mocked(signIn).mockReset();
});

/**
 * The footer of the sign-in form is the only place the app talks about
 * getting an account, so it must agree with /api/signup, which accepts
 * nothing but an invite.
 */
describe('SignInForm sign-up footer', () => {
  it('tells visitors the instance is invite-only', async () => {
    await render(<SignInForm callbackUrl="/dashboard" hint={null} />);

    await expect.element(page.getByText('This instance is invite-only — ask an admin for an invite link to join.')).toBeInTheDocument();
  });

  it('offers no sign-up link', async () => {
    await render(<SignInForm callbackUrl="/dashboard" hint={null} />);

    expect(page.getByRole('link', { name: 'Create an account' }).elements()).toHaveLength(0);
  });
});

describe('SignInForm ways in', () => {
  it('shows only the password form when the server offers nothing else', async () => {
    await render(<SignInForm callbackUrl="/dashboard" hint={null} />);

    await expect.element(page.getByLabelText('Password', { exact: true })).toBeInTheDocument();
    expect(page.getByRole('button', { name: /Continue with/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Email me a sign-in link' }).elements()).toHaveLength(0);
  });

  it('puts a button per configured provider above the email form', async () => {
    await render(<SignInForm callbackUrl="/dashboard" hint={null} providers={PROVIDERS} />);

    await expect.element(page.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Continue with Microsoft' })).toBeInTheDocument();

    await page.getByRole('button', { name: 'Continue with Microsoft' }).click();

    expect(signIn).toHaveBeenCalledWith('microsoft-entra-id', { callbackUrl: '/dashboard' });
  });

  it('leads with the email link when mail is set up, and keeps the password one click away', async () => {
    await render(<SignInForm callbackUrl="/dashboard" hint={null} emailLink />);

    await expect.element(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument();
    expect(page.getByLabelText('Password', { exact: true }).elements()).toHaveLength(0);

    await page.getByRole('button', { name: 'Use a password' }).click();

    await expect.element(page.getByLabelText('Password', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('answers a link request the same way for every address', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, error: undefined, status: 200, url: 'http://localhost/sign-in?provider=email&type=email', code: undefined });
    await render(<SignInForm callbackUrl="/dashboard" hint={null} emailLink />);

    await page.getByLabelText('Email').fill('dana@northwind.example');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

    await expect.element(page.getByText('If you have an account, we\'ve sent a link to dana@northwind.example. It works once, for 15 minutes.')).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledWith('email', { email: 'dana@northwind.example', redirect: false, callbackUrl: '/dashboard' });
  });

  it('says why a provider sign-in was refused', async () => {
    await render(<SignInForm callbackUrl="/dashboard" hint={null} providers={PROVIDERS} outcome={{ error: 'AccessDenied', reason: 'no-invite', providerLabel: 'Google' }} />);

    await expect.element(page.getByRole('alert')).toHaveTextContent('No invite for this address. Ask an admin to invite you.');
  });
});
