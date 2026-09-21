import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { Inbox, InboxItem, InboxKind } from '@/services/InboxService';
import { NextIntlClientProvider } from 'next-intl';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { INBOX_KINDS } from '@/services/inbox/kinds';
import { InboxList } from './InboxList';

/**
 * Review queue, on the shared `ListRow`. The rows here and the rows on Search,
 * Artifacts, Personalization and Learnings are the same component; only the
 * data differs.
 */
const meta: Meta<typeof InboxList> = {
  title: 'Inbox/List',
  component: InboxList,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="@container mx-auto max-w-5xl">
          <TitleBar title="Review queue" description="Everything waiting on a person, oldest first." />
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof InboxList>;

function item(over: Partial<InboxItem> & Pick<InboxItem, 'key' | 'kind' | 'title'>): InboxItem {
  return {
    shape: 'single',
    subline: 'Contoso Supply › hubspot.update › recommended by revenue-lead',
    agentSlug: 'revenue-lead',
    teamSlug: 'revenue',
    risk: null,
    status: 'pending',
    at: new Date('2026-09-12T09:00:00.000Z'),
    href: '/dashboard/inbox/proposal-1',
    confidence: 0.88,
    amount: null,
    currency: null,
    reviewId: 1,
    ...over,
  };
}

const ITEMS: InboxItem[] = [
  item({ key: 'p:1', kind: 'proposal', title: 'Enroll Jamie Smith in the MQL sequence', amount: 12500, currency: 'USD' }),
  item({ key: 'p:2', kind: 'proposal', title: 'Update the Meridian Group deal stage', risk: 'high', confidence: 0.61, amount: 48000, currency: 'USD', at: new Date('2026-09-10T09:00:00.000Z') }),
  item({ key: 'a:3', kind: 'input', title: 'Which pricing tier should the Orlin proposal quote?', subline: 'Orlin Health › proposal-writer', confidence: null, reviewId: undefined, askId: 3, href: '/dashboard/inbox/3', at: new Date('2026-09-09T09:00:00.000Z') }),
  item({ key: 'l:4', kind: 'learning', title: 'Always name the discovery call date in the first line', subline: 'outreach › from 3 decisions', confidence: 0.74, reviewId: undefined, href: '/dashboard/inbox/learning-4', at: new Date('2026-09-08T09:00:00.000Z') }),
];

const counts = Object.fromEntries(INBOX_KINDS.map(k => [k, ITEMS.filter(i => i.kind === k).length])) as Record<InboxKind, number>;

const INBOX: Inbox = {
  items: ITEMS,
  counts,
  total: ITEMS.length,
  tabs: { open: ITEMS.length, decided: 12, snoozed: 1 },
  facets: {
    actionKinds: [{ id: 'hubspot.update', count: 2 }],
    agents: [{ slug: 'revenue-lead', count: 2 }, { slug: 'proposal-writer', count: 1 }],
  },
};

export const Open: Story = {
  args: { inbox: INBOX, tab: 'open' },
};

export const Decided: Story = {
  args: {
    inbox: {
      ...INBOX,
      items: ITEMS.map(i => ({ ...i, decision: 'approved', decidedBy: 'Chris', note: null })),
    },
    tab: 'decided',
  },
};
