import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { InviteRow, PersonRow } from './access';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/locales/en.json';
import { PeopleTab } from './PeopleTab';

/**
 * The People lane on `/dashboard/members`: the people on the account, and
 * under them the invites nobody has accepted yet — the same `ListRow` in the
 * same columns, with the invite's state where a person's reach sits. Actions
 * are stubbed. Fixtures are fictional.
 */
const meta: Meta<typeof PeopleTab> = {
  title: 'Members/People',
  component: PeopleTab,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={en}>
        <div className="@container mx-auto max-w-5xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof PeopleTab>;

const PEOPLE: PersonRow[] = [
  {
    userId: 'u-brit',
    name: 'Brit Nakamura',
    email: 'brit@northwind.example',
    accountRole: 'admin',
    groups: [],
    reaches: ['Revenue Team', 'Delivery Stack'],
    direct: [],
    joinedAt: new Date('2026-08-01T00:00:00Z'),
  },
  {
    userId: 'u-alex',
    name: 'Alex Morrow',
    email: 'alex@northwind.example',
    accountRole: 'member',
    groups: ['revops'],
    reaches: ['Revenue Team'],
    direct: [],
    joinedAt: new Date('2026-09-15T00:00:00Z'),
  },
];

const PENDING: InviteRow = {
  inviteId: 'inv-casey',
  email: 'casey@kestrel.example',
  accountRole: 'member',
  token: 'tok-casey',
  invitedAt: new Date('2026-10-01T00:00:00Z'),
  invitedBy: 'Brit Nakamura',
  expiresAt: new Date('2026-10-15T00:00:00Z'),
  expired: false,
};

const EXPIRED: InviteRow = {
  inviteId: 'inv-devon',
  email: 'devon@contoso.example',
  accountRole: 'admin',
  token: 'tok-devon',
  invitedAt: new Date('2026-09-06T00:00:00Z'),
  invitedBy: 'Brit Nakamura',
  expiresAt: new Date('2026-09-20T00:00:00Z'),
  expired: true,
};

const base = {
  rows: PEOPLE,
  sharedCount: 2,
  isAdmin: true,
  currentUserId: 'u-brit',
  pending: false,
  anyPeople: true,
  onChangeRole: () => {},
  onRemoveDirect: () => {},
  onRemoveMember: () => {},
  onRevokeInvite: () => {},
  onReinvite: () => {},
};

/** One invite waiting to be accepted, under the people already on the account. */
export const PendingInvite: Story = {
  args: { ...base, invites: [PENDING] },
};

/** A lapsed invite: its link no longer works, so the row offers Re-invite. */
export const ExpiredInvite: Story = {
  args: { ...base, invites: [PENDING, EXPIRED] },
};

/** Status: invited — only the invites. */
export const InvitesOnly: Story = {
  args: { ...base, rows: [], invites: [PENDING, EXPIRED] },
};
