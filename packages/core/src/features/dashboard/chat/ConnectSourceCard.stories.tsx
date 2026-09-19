import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { ConnectSource } from './types';
import { ConnectSourceCard } from './ConnectSourceCard';

/**
 * The connect card — the four states core can put in front of somebody, in one
 * place, so the wording can be read side by side.
 *
 * The rule the stack exists to check is the scope line: it is a required
 * field, not copy. Read down the column and every card says whose connection
 * it would be BEFORE the button, because nobody should have to wonder whether
 * they just handed the company their mailbox.
 * @param overrides
 */
function base(overrides: Partial<ConnectSource> = {}): ConnectSource {
  return {
    connectorSlug: 'google-calendar',
    name: 'Google Calendar',
    icon: 'Calendar',
    platform: 'google',
    scope: 'user',
    state: 'connect',
    authKind: 'oauth',
    reason: 'The answer needs Google Calendar — it was about to read events (timeMin, timeMax).',
    requestedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    tool: 'list_events',
    workspaceGrantAvailable: false,
    ...overrides,
  };
}

function Pane({ connect }: { connect: ConnectSource }) {
  return (
    <div style={{ width: 440 }} className="rounded-xl bg-background p-3">
      <p className="mb-1 text-[13px] leading-relaxed text-foreground/80">
        I'll pull tomorrow's meetings and prep you for each one.
      </p>
      <ConnectSourceCard connect={connect} onSkip={() => {}} />
    </div>
  );
}

const meta: Meta<typeof Pane> = {
  title: 'Chat/ConnectSourceCard',
  component: Pane,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof Pane>;

/** Personal · OAuth · any member. The common case. */
export const Personal: Story = { args: { connect: base() } };

/**
 * Shared · a member, not an admin. A shared key is a company asset, so the
 * card names who connects it instead of offering a button that binds one — and
 * has no Skip, because there is nothing this person could have done instead.
 */
export const NeedsAdmin: Story = {
  args: {
    connect: base({
      connectorSlug: 'hubspot',
      name: 'HubSpot',
      icon: 'Contact',
      platform: 'hubspot',
      scope: 'workspace',
      state: 'needs-admin',
      authKind: 'apikey',
      reason: 'The deal history for Northwind lives in HubSpot.',
      requestedScopes: [],
      tool: 'hubspot_get_deal',
    }),
  },
};

/** A grant that existed and stopped working. Reconnect, never connect. */
export const Broken: Story = {
  args: { connect: base({ state: 'reconnect', reason: 'Your Google Calendar grant can no longer be used.' }) },
};

/** The `either` tier's second line: a colleague already connected this one. */
export const WorkspaceGrantOffered: Story = {
  args: {
    connect: base({
      connectorSlug: 'slack',
      name: 'Slack',
      icon: 'MessageSquare',
      platform: 'slack',
      reason: 'The thread you are asking about is in Slack.',
      requestedScopes: [],
      tool: 'slack_read_thread',
      workspaceGrantAvailable: true,
    }),
  },
};
