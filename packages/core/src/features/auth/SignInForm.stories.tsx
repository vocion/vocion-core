import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import { SignInForm } from '@/app/[locale]/(auth)/(center)/sign-in/SignInForm';
import en from '@/locales/en.json';

/**
 * The sign-in page in each shape a deployment can give it. The server
 * decides which ways in exist — a button per configured provider, the email
 * link when mail is set up, the password always — and the form shows exactly
 * those, in that order. "Forgot password?" sits beside the password field.
 */
const meta: Meta<typeof SignInForm> = {
  title: 'Auth/Sign in',
  component: SignInForm,
  parameters: { layout: 'centered' },
  args: { callbackUrl: '/dashboard', hint: null },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={en}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof SignInForm>;

const BOTH = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft-entra-id', label: 'Microsoft' },
];

/** Nothing configured beyond the password: the form as it has always been. */
export const PasswordOnly: Story = {};

/** Google and Microsoft above the email field, which mails a sign-in link; "Use a password" one click away. */
export const EveryWayIn: Story = {
  args: { providers: BOTH, emailLink: true },
};

/** Google only, no outbound mail: the button, then email and password. */
export const GoogleAndPassword: Story = {
  args: { providers: [BOTH[0]!] },
};

/** A Google sign-in for an address nobody invited came back refused. */
export const RefusedNoInvite: Story = {
  args: {
    providers: BOTH,
    emailLink: true,
    outcome: { error: 'AccessDenied', reason: 'no-invite', providerLabel: 'Google' },
  },
};

/** A personal Microsoft account, where only work or school accounts are taken. */
export const RefusedPersonalMicrosoftAccount: Story = {
  args: {
    providers: BOTH,
    outcome: { error: 'AccessDenied', reason: 'personal-account', providerLabel: 'Microsoft' },
  },
};

/** A sign-in link that was already used, or older than fifteen minutes. */
export const ExpiredLink: Story = {
  args: { emailLink: true, outcome: { error: 'Verification' } },
};

/** After "Email me a sign-in link": the same answer whatever the address. */
export const CheckYourEmail: Story = {
  args: { providers: BOTH, emailLink: true, linkSent: true },
};

/** Ten wrong passwords from one address: the form says to wait, not "wrong password". */
export const LockedOut: Story = {
  args: { outcome: { error: 'CredentialsSignin', code: 'rate_limited' } },
};
