import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { ConfigureInput } from './configurePlan';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/locales/en.json';
import { ConfigureLayout } from './ConfigureLayout';
import { planConfigure } from './configurePlan';

/**
 * Configure → Repos (FE-535, 2026-10-26): where the repositories the factory
 * builds live, and where each stands. Every name is invented.
 */
const input: ConfigureInput = {
  pluginName: 'Software factory',
  seats: [],
  skills: [],
  automations: [],
  trust: [],
  learnings: [],
  measures: [],
  changes: [],
  records: [
    { id: 536, title: 'Harbor web app', status: 'approved', facts: ['github.com/acme-example/harbor-web', 'harbor', '3 checks'], href: '/dashboard/objects/536' },
    { id: 530, title: 'Harbor API', status: 'rejected', facts: ['github.com/acme-example/harbor-api', 'harbor', '2 checks'], href: '/dashboard/objects/530' },
    { id: 531, title: 'Harbor landing page', status: 'rejected', facts: ['github.com/acme-example/harbor-lp', 'harbor', 'no checks'], href: '/dashboard/objects/531' },
    { id: 532, title: 'Harbor MCP server', status: 'candidate', facts: ['github.com/acme-example/harbor-mcp', 'harbor', '1 check'], href: '/dashboard/objects/532' },
  ],
};

const view = planConfigure(input, {
  tabs: [{ kind: 'records', type: 'repo', label: 'Repos' }, { kind: 'seats' }, { kind: 'automations' }, { kind: 'trust' }],
  aside: [],
}, { tab: 'records', now: Date.now() });

const meta = {
  title: 'Configure/Repos',
  component: ConfigureLayout,
  decorators: [Story => <NextIntlClientProvider locale="en" messages={messages}><div className="p-6"><Story /></div></NextIntlClientProvider>],
  args: { view },
} satisfies Meta<typeof ConfigureLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Repos: Story = {};
