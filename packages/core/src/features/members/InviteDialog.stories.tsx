import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { CreatedInvite } from './InviteDialog';
import type { InviteDelivery } from '@/services/InviteMail';
import { NextIntlClientProvider } from 'next-intl';
import { expect, userEvent, within } from 'storybook/test';
import en from '@/locales/en.json';
import { InviteDialog } from './InviteDialog';

/**
 * "Invite member" on the People lane. With mail on, the invite is emailed
 * ("Join Northwind on Vocion") and the dialog says so; the link is there to
 * copy either way. With mail off, the link is the invite. A mail that did not
 * go says why, and the link is the fallback. The create call is stubbed.
 * Fixtures are fictional.
 */
const meta: Meta<typeof InviteDialog> = {
  title: 'Members/Invite dialog',
  component: InviteDialog,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={en}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  args: { open: true, pending: false, error: null, onOpenChange: () => {} },
};

export default meta;

type Story = StoryObj<typeof InviteDialog>;

/**
 * A stub that "creates" the invite and reports what happened to its mail.
 * @param delivery - What became of the email.
 */
function creates(delivery: InviteDelivery) {
  return async (email: string, role: 'admin' | 'member'): Promise<CreatedInvite> => ({
    id: 'inv-casey',
    email,
    role,
    token: 'tok-casey',
    createdAt: new Date('2026-10-08T12:00:00Z'),
    expiresAt: new Date('2026-10-22T12:00:00Z'),
    expired: false,
    invitedBy: { userId: 'u-brit', name: 'Brit Nakamura', email: 'brit@northwind.example' },
    delivery,
  });
}

/**
 * Fill the address and send — the dialog sits in a portal, so the play
 * looks in the whole document.
 * @param ctx - Storybook's play context.
 * @param ctx.canvasElement - The story's root.
 * @param button - The submit button's name.
 */
async function invite({ canvasElement }: { canvasElement: HTMLElement }, button: string) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.type(body.getByLabelText('Email'), 'casey@kestrel.example');
  await userEvent.click(body.getByRole('button', { name: button }));
  return body;
}

/** Mail on, before anything is sent. */
export const MailOn: Story = {
  args: { emails: true, onInvite: creates({ status: 'sent' }) },
};

/** Mail off, before the link is made. */
export const MailOff: Story = {
  args: { emails: false, onInvite: creates({ status: 'mail-off' }) },
};

/** Emailed: the address got "Join Northwind on Vocion"; the link is here too. */
export const Emailed: Story = {
  args: { emails: true, onInvite: creates({ status: 'sent' }) },
  play: async (ctx) => {
    const body = await invite(ctx, 'Send invite');

    await expect(await body.findByText('Emailed to casey@kestrel.example. The link works too:')).toBeInTheDocument();
  },
};

/** Mail off: the link is the invite, to copy and share. */
export const LinkToShare: Story = {
  args: { emails: false, onInvite: creates({ status: 'mail-off' }) },
  play: async (ctx) => {
    const body = await invite(ctx, 'Create link');

    await expect(await body.findByText('Link for casey@kestrel.example')).toBeInTheDocument();
  },
};

/** Mail on, and this one did not go: why, and the link to send by hand. */
export const NotEmailed: Story = {
  args: {
    emails: true,
    onInvite: creates({ status: 'failed', reason: 'This server does not know its own address (NEXT_PUBLIC_APP_URL), so the link could not be mailed. Copy it instead.' }),
  },
  play: async (ctx) => {
    const body = await invite(ctx, 'Send invite');

    await expect(await body.findByText('Not emailed to casey@kestrel.example.')).toBeInTheDocument();
  },
};
