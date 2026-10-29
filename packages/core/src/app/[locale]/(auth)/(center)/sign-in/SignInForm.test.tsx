import { signIn } from 'next-auth/react';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { OrgBrandProvider } from '@/features/branding/BrandContext';
import { NORTHWIND_VIEW } from '@/features/branding/northwind.fixture';
import messages from '@/locales/en.json';
import { SignInForm } from './SignInForm';

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft-entra-id', label: 'Microsoft' },
];

beforeEach(() => {
  vi.mocked(signIn).mockReset();
});

function renderForm(props: Partial<React.ComponentProps<typeof SignInForm>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SignInForm callbackUrl="/dashboard" hint={null} {...props} />
    </NextIntlClientProvider>,
  );
}

/**
 * The footer of the sign-in form is the only place the app talks about
 * joining. Accounts come from invites only, so it must never offer a sign-up
 * link — and it must say how to get in instead.
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
  it('shows only the password form when the server offers nothing else', async () => {
    await renderForm();

    await expect.element(page.getByLabelText('Password', { exact: true })).toBeInTheDocument();
    expect(page.getByRole('button', { name: /Continue with/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Email me a sign-in link' }).elements()).toHaveLength(0);
  });

  it('links to forgot-password beside the password', async () => {
    await renderForm();

    await expect.element(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
  });

  it('puts a button per configured provider above the email form', async () => {
    await renderForm({ providers: PROVIDERS });

    await expect.element(page.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Continue with Microsoft' })).toBeInTheDocument();

    await page.getByRole('button', { name: 'Continue with Microsoft' }).click();

    expect(signIn).toHaveBeenCalledWith('microsoft-entra-id', { callbackUrl: '/dashboard' });
  });

  it('leads with the email link when mail is set up, and keeps the password (and its reset) one click away', async () => {
    await renderForm({ emailLink: true });

    await expect.element(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument();
    expect(page.getByLabelText('Password', { exact: true }).elements()).toHaveLength(0);

    await page.getByRole('button', { name: 'Use a password' }).click();

    await expect.element(page.getByLabelText('Password', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument();
  });

  it('answers a link request the same way for every address', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, error: undefined, status: 200, url: 'http://localhost/sign-in?provider=email&type=email', code: undefined });
    await renderForm({ emailLink: true });

    await page.getByLabelText('Email').fill('dana@northwind.example');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

    await expect.element(page.getByText('If you have an account, we\'ve sent a link to dana@northwind.example. It works once, for 15 minutes.')).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledWith('email', { email: 'dana@northwind.example', redirect: false, callbackUrl: '/dashboard' });
  });

  it('says why a provider sign-in was refused', async () => {
    await renderForm({ providers: PROVIDERS, outcome: { error: 'AccessDenied', reason: 'no-invite', providerLabel: 'Google' } });

    await expect.element(page.getByRole('alert')).toHaveTextContent('No invite for this address. Ask an admin to invite you.');
  });

  it('says to wait, not "wrong password", after a lockout', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: false, error: 'CredentialsSignin', code: 'rate_limited', status: 401, url: null });
    await renderForm();

    await page.getByLabelText('Email').fill('dana@northwind.example');
    await page.getByLabelText('Password', { exact: true }).fill('not-it');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect.element(page.getByRole('alert')).toHaveTextContent('Too many sign-in attempts. Wait a few minutes, then try again.');
  });
});

/**
 * An Org's own sign-in: its logo and name where Vocion's were, its accent on
 * the one button, and a small "Powered by Vocion" kept underneath.
 */
describe('SignInForm in an Org\'s brand', () => {
  it('wears the Org\'s logo, name and accent, and keeps "Powered by Vocion"', async () => {
    await render(<NextIntlClientProvider locale="en" messages={messages}><OrgBrandProvider value={NORTHWIND_VIEW}><SignInForm callbackUrl="/dashboard" hint={null} /></OrgBrandProvider></NextIntlClientProvider>);

    await expect.element(page.getByRole('img', { name: 'Northwind' }).first()).toBeInTheDocument();
    await expect.element(page.getByText('Sign in to Northwind')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Sign in' })).toHaveClass(/bg-org-accent/);
    await expect.element(page.getByTestId('powered-by-vocion')).toBeInTheDocument();
  });

  it('white-labelled, the Org\'s alone', async () => {
    await render(<NextIntlClientProvider locale="en" messages={messages}><OrgBrandProvider value={{ ...NORTHWIND_VIEW, poweredBy: false }}><SignInForm callbackUrl="/dashboard" hint={null} /></OrgBrandProvider></NextIntlClientProvider>);

    await expect.element(page.getByText('Sign in to Northwind')).toBeInTheDocument();
    expect(page.getByTestId('powered-by-vocion').elements()).toHaveLength(0);
  });

  it('with no brand, it is Vocion\'s sign-in as it was', async () => {
    await renderForm();

    await expect.element(page.getByText('Sign in to your workspace')).toBeInTheDocument();
    expect(page.getByTestId('powered-by-vocion').elements()).toHaveLength(0);
    await expect.element(page.getByRole('button', { name: 'Sign in' })).not.toHaveClass(/bg-org-accent/);
  });
});

/**
 * The line under the form says the install's policy, not a generic rule: the
 * domains that join by themselves, else whom to ask — and a server that knows
 * no Org before sign-in (multi-Org) keeps the plain invite-only line.
 */
describe('SignInForm access line', () => {
  it('names the domains that join without an invite, and the providers that prove them', async () => {
    await renderForm({ providers: PROVIDERS, access: { org: 'Northwind', autoJoin: { domains: ['northwind.example'], providers: ['Google', 'Microsoft'] } } });

    await expect.element(page.getByTestId('sign-in-access')).toHaveTextContent('Anyone with a @northwind.example account can sign in with Google or Microsoft.');
    await expect.element(page.getByText('Sign in to Northwind')).toBeInTheDocument();
  });

  it('otherwise says whom to ask, by the Org\'s name, before anyone signs in', async () => {
    await renderForm({ access: { org: 'Northwind', autoJoin: null } });

    await expect.element(page.getByTestId('sign-in-access')).toHaveTextContent('Need access? Ask someone at Northwind to invite you.');
  });

  it('a multi-Org server, which knows no Org yet, keeps the invite-only line', async () => {
    await renderForm({ access: { org: null, autoJoin: null } });

    await expect.element(page.getByTestId('sign-in-access')).toHaveTextContent('This instance is invite-only');
  });
});

/**
 * On a slow phone or a busy box the page is on screen before React has
 * hydrated it, and a person (or their password manager, or a test) can fill
 * the email in that gap. React's state for the field is still empty, so the
 * next render (filling the password) used to wipe the email, and "Sign in"
 * then did nothing: the browser refused the empty required field. This took
 * main's CI down (PhoneOverflow.e2e.ts, 2026-10-28 and 2026-10-29).
 */
/**
 * Runs `work` inside act(), so React has finished rendering (or hydrating)
 * when it returns. act() is switched on only for this, as vitest-browser-react
 * does for its own render, so the clicks and typing after it do not warn.
 * @param work - What React should finish.
 */
async function settled<T>(work: () => T): Promise<T> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const was = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    let result!: T;
    await act(async () => {
      result = work();
    });
    return result;
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = was;
  }
}

describe('SignInForm filled before it hydrates', () => {
  it('keeps the email typed before hydration once the password is filled, and signs in with it', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: false, error: 'CredentialsSignin', code: 'credentials', status: 401, url: null });
    const tree = (
      <NextIntlClientProvider locale="en" messages={messages}>
        <SignInForm callbackUrl="/dashboard" hint={null} />
      </NextIntlClientProvider>
    );
    // The page as the server sends it: the form's HTML, not yet React's.
    // (Rendered on the client and copied, because a react-dom/server import
    // would make Vite re-optimise mid-run and reload the browser tests.)
    const scratch = document.createElement('div');
    const scratchRoot = await settled(() => createRoot(scratch));
    await settled(() => scratchRoot.render(tree));
    const container = document.createElement('div');
    container.innerHTML = scratch.innerHTML;
    await settled(() => scratchRoot.unmount());
    document.body.append(container);
    // The server's HTML, filled in by hand before React takes it over.
    container.querySelector<HTMLInputElement>('#email')!.value = 'dana@northwind.example';

    const root = await settled(() => hydrateRoot(container, tree));
    try {
      await page.getByLabelText('Password', { exact: true }).fill('correct horse');

      await expect.element(page.getByLabelText('Email')).toHaveValue('dana@northwind.example');

      await page.getByRole('button', { name: 'Sign in' }).click();

      await vi.waitFor(() => expect(signIn).toHaveBeenCalledWith('credentials', { email: 'dana@northwind.example', password: 'correct horse', redirect: false, callbackUrl: '/dashboard' }));
    } finally {
      await settled(() => root.unmount());
      container.remove();
    }
  });
});
