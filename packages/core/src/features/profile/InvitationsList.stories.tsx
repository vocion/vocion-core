import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/locales/en.json';
import { InvitationsList } from './InvitationsSection';

/**
 * The profile's "Invitations": Orgs that invited this person's address after
 * they signed up, each joined in one click on the login they already have.
 * The `org-invited` notification opens here. Fixtures are fictional.
 */
const meta: Meta<typeof InvitationsList> = {
  title: 'Profile/Invitations',
  component: InvitationsList,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <div className="mx-auto max-w-3xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
  args: { onJoin: async () => null },
};

export default meta;

type Story = StoryObj<typeof InvitationsList>;

const IN_TWO_WEEKS = new Date('2026-10-22T12:00:00Z');

/** Two Orgs asked, on a multi-Org server: each has its Join. */
export const TwoOrgs: Story = {
  args: {
    invitations: [
      { token: 'tok-kestrel', orgName: 'Kestrel Capital', role: 'member', expiresAt: IN_TWO_WEEKS, problem: null },
      { token: 'tok-contoso', orgName: 'Contoso', role: 'admin', expiresAt: IN_TWO_WEEKS, problem: null },
    ],
  },
};

/** A single-Org server cannot hold a second Org: the invite says why, with no button. */
export const SingleOrgRefusal: Story = {
  args: {
    invitations: [
      {
        token: 'tok-kestrel',
        orgName: 'Kestrel Capital',
        role: 'member',
        expiresAt: IN_TWO_WEEKS,
        problem: 'This Vocion server runs a single Org, and you already belong to Northwind, so you can\'t also join Kestrel Capital here. Ask an admin of Kestrel Capital to invite a different email.',
      },
    ],
  },
};

/** Joining failed (the invite was revoked meanwhile): the sentence sits under it. */
export const JoinRefused: Story = {
  args: {
    invitations: [{ token: 'tok-kestrel', orgName: 'Kestrel Capital', role: 'member', expiresAt: IN_TWO_WEEKS, problem: null }],
    onJoin: async () => 'Invalid invite token.',
  },
};
