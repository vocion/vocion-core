import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import { expect, userEvent, within } from 'storybook/test';
import { ForgotPasswordForm } from '@/app/[locale]/(auth)/(center)/forgot-password/ForgotPasswordForm';
import { ResetPasswordForm } from '@/app/[locale]/(auth)/(center)/reset-password/ResetPasswordForm';
import en from '@/locales/en.json';

/**
 * "Forgot password?" end to end, as the person sees it: ask for a link
 * (`/forgot-password`, the same answer for every address), then open it
 * (`/reset-password#token=…`): checking the link, a spent or expired one, the
 * new-password form, and done. The auth routes are stubbed by replacing
 * `fetch` for the story; the token rides in the URL fragment exactly as the
 * mailed link carries it.
 */
const meta: Meta = {
  title: 'Auth/Password reset',
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={en}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj;

/** What each stubbed route answers; a missing route never answers. */
type Routes = Record<string, () => Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Replace `fetch` for one story, and put a reset token in the fragment when
 * the story needs one. Returns the cleanup Storybook runs afterwards.
 * @param routes - The routes to answer.
 * @param token - The token for `#token=`, or null for a link without one.
 */
function stub(routes: Routes, token: string | null = null) {
  return () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const path = url.startsWith('http') ? new URL(url).pathname : url;
      const answer = routes[path];
      return answer ? answer() : new Promise<Response>(() => {});
    }) as typeof fetch;
    const before = window.location.pathname + window.location.search;
    if (token) {
      window.history.replaceState(window.history.state, '', `${before}#token=${token}`);
    }
    return () => {
      globalThis.fetch = real;
      window.history.replaceState(window.history.state, '', before);
    };
  };
}

/** The form behind "Forgot password?". */
export const ForgotPassword: Story = {
  render: () => <ForgotPasswordForm />,
};

/** After asking: the same sentence whether or not the address has a login. */
export const ForgotPasswordSent: Story = {
  render: () => <ForgotPasswordForm />,
  beforeEach: stub({ '/api/password-reset': () => json({ ok: true }) }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Email'), 'dana@northwind.example');
    await userEvent.click(canvas.getByRole('button', { name: 'Send reset link' }));

    await expect(await canvas.findByText('Check your email')).toBeInTheDocument();
    await expect(canvas.getByText(/dana@northwind\.example has a login here/)).toBeInTheDocument();
  },
};

/** Too many requests from one address or for one email. */
export const ForgotPasswordRateLimited: Story = {
  render: () => <ForgotPasswordForm />,
  beforeEach: stub({ '/api/password-reset': () => new Response(JSON.stringify({ error: 'Too many requests.' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '1800' } }) }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Email'), 'dana@northwind.example');
    await userEvent.click(canvas.getByRole('button', { name: 'Send reset link' }));

    await expect(await canvas.findByRole('alert')).toHaveTextContent('Try again in 30 minutes');
  },
};

/** The link opened; the page is checking it before asking for anything. */
export const ResetChecking: Story = {
  render: () => <ResetPasswordForm />,
  beforeEach: stub({}, 'tok-northwind'),
};

/** A link already used, or older than thirty minutes: says so before anyone types. */
export const ResetLinkExpired: Story = {
  render: () => <ResetPasswordForm />,
  beforeEach: stub({ '/api/password-reset/check': () => json({ live: false }) }, 'tok-spent'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText('This link has expired')).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Send a new link' })).toBeInTheDocument();
  },
};

/** A live link: choose the new password. */
export const ResetChooseNewPassword: Story = {
  render: () => <ResetPasswordForm />,
  beforeEach: stub({ '/api/password-reset/check': () => json({ live: true }) }, 'tok-live'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByLabelText('New password')).toBeInTheDocument();
  },
};

/** The two entries disagree: said before anything is sent. */
export const ResetMismatch: Story = {
  render: () => <ResetPasswordForm />,
  beforeEach: stub({ '/api/password-reset/check': () => json({ live: true }) }, 'tok-live'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText('New password'), 'correct-horse-battery');
    await userEvent.type(canvas.getByLabelText('Confirm new password'), 'correct-horse-staple');
    await userEvent.click(canvas.getByRole('button', { name: 'Set password' }));

    await expect(await canvas.findByRole('alert')).toHaveTextContent('The passwords do not match.');
  },
};

/** Done: the new password is set, every other session ended, sign in with it. */
export const ResetDone: Story = {
  render: () => <ResetPasswordForm />,
  beforeEach: stub({
    '/api/password-reset/check': () => json({ live: true }),
    '/api/password-reset/confirm': () => json({ ok: true }),
  }, 'tok-live'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText('New password'), 'correct-horse-battery');
    await userEvent.type(canvas.getByLabelText('Confirm new password'), 'correct-horse-battery');
    await userEvent.click(canvas.getByRole('button', { name: 'Set password' }));

    await expect(await canvas.findByText('Password changed')).toBeInTheDocument();
  },
};
