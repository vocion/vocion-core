import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { WorkforceInventory } from '@/services/adoption/WorkforceService';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/locales/en.json';
import { WorkforceInventoryPanel } from './WorkforceInventoryPanel';

const report: WorkforceInventory = {
  schemaVersion: 1,
  workspaceId: 'sample',
  generatedAt: '2026-10-29T12:00:00Z',
  window: { days: 7, from: '2026-10-22T12:00:00Z', to: '2026-10-29T12:00:00Z' },
  agents: ['Draft writer', 'Evidence reviewer', 'Research assistant', 'Archive assistant'].map((name, i) => ({
    slug: `agent-${i}`,
    name,
    purpose: 'Prepare clear, sourced work for a person to review.',
    enabled: i !== 3,
    teamSlug: i < 2 ? 'content' : 'research',
    ownerUserId: null,
    skills: ['research'],
    playbooks: ['weekly-brief'],
    humanEvents: 0,
    toolCalls: i === 3 ? 0 : 20 + i,
    modelCalls: i === 3 ? 0 : 12,
    modelCostUsd: i === 3 ? null : 1.25,
    reviewDecisions: i === 0 ? 10 : 0,
    acceptedAsIsRate: i === 0 ? 0.6 : null,
    lastModelCallAt: null,
    lastHumanActivityAt: null,
    lastToolCallAt: null,
  })),
  teams: [{ slug: 'content', name: 'Content', goal: 'Publish useful, accurate explanations.', leadAgentSlug: null, ownerUserId: null }, { slug: 'research', name: 'Research', goal: 'Turn source material into verifiable evidence.', leadAgentSlug: null, ownerUserId: null }],
  coverage: { localEvents: 42, lastLocalEventAt: null, unlinkedAgentEvents: 0, completeness: 'unverified', amplitudeConfiguration: null, amplitudeDelivery: 'unverified' },
};
const meta: Meta<typeof WorkforceInventoryPanel> = {
  title: 'Workforce/Performance',
  component: WorkforceInventoryPanel,
  parameters: { layout: 'padded' },
  decorators: [Story => <NextIntlClientProvider locale="en" messages={messages}><div className="mx-auto max-w-6xl"><Story /></div></NextIntlClientProvider>],
};
export default meta;
type Story = StoryObj<typeof WorkforceInventoryPanel>;
export const Weekly: Story = { args: { report } };
