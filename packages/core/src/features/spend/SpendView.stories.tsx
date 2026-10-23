import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/locales/en.json';
import { SpendView } from './SpendView';

const meta = {
  title: 'Observability/Spend',
  component: SpendView,
  decorators: [Story => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <div className="max-w-4xl p-6"><Story /></div>
    </NextIntlClientProvider>
  )],
} satisfies Meta<typeof SpendView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An Org admin reading the whole Org by workspace, last 30 days. Fictional figures. */
export const ByWorkspace: Story = {
  args: {
    canReadOrg: true,
    state: { scope: 'org', group: 'workspace', period: '30d', filters: {} },
    result: {
      rows: [
        { key: 'ws_revenue', label: 'Northwind Revenue', calls: 18_420, tokens: 61_300_000, microCents: 41_870_000_000 },
        { key: 'ws_finance', label: 'Northwind Finance', calls: 6_210, tokens: 19_800_000, microCents: 12_340_000_000 },
        { key: 'ws_delivery', label: 'Northwind Delivery', calls: 3_905, tokens: 22_100_000, microCents: 9_610_000_000 },
        { key: 'ws_personal', label: 'Personal', calls: 812, tokens: 1_900_000, microCents: 730_000_000 },
      ],
      total: { calls: 29_347, tokens: 105_100_000, microCents: 64_550_000_000 },
    },
  },
};

/** One agent's spend by model, drilled into from the agent row. */
export const AgentByModel: Story = {
  args: {
    canReadOrg: true,
    filterLabel: 'revenue-lead',
    state: { scope: 'workspace', group: 'model', period: '7d', filters: { agentSlug: 'revenue-lead' } },
    result: {
      rows: [
        { key: 'claude-opus-5-5', label: 'claude-opus-5-5', calls: 212, tokens: 4_800_000, microCents: 6_120_000_000 },
        { key: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5', calls: 1_604, tokens: 9_300_000, microCents: 3_480_000_000 },
        { key: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5-20251001', calls: 3_118, tokens: 2_100_000, microCents: 310_000_000 },
      ],
      total: { calls: 4_934, tokens: 16_200_000, microCents: 9_910_000_000 },
    },
  },
};
