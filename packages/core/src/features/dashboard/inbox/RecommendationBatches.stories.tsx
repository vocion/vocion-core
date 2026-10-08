import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { BatchResult, RecommendationBatch } from '@/services/needsYou/batches';
import { NextIntlClientProvider } from 'next-intl';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { RecommendationBatches } from './RecommendationBatches';

/**
 * Accept in one move — the decisions on Needs you that carry the same
 * recommendation, gathered above the queue. Each line opens to the items it
 * covers; Accept decides each as recommended.
 */
const meta: Meta<typeof RecommendationBatches> = {
  title: 'Inbox/Recommendation batches',
  component: RecommendationBatches,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="@container mx-auto max-w-5xl">
          <TitleBar title="Review queue" description="24 decisions, oldest waiting 9d." />
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof RecommendationBatches>;

const APPROVE: RecommendationBatch = {
  key: 'approve',
  label: 'Approve',
  count: 5,
  items: [
    { ref: 'ask:31', kind: 'approval', title: 'Renew the Northwind support contract for another year?', href: '/dashboard/inbox/31' },
    { ref: 'ask:32', kind: 'approval', title: 'Add Kestrel Capital to the quarterly investor update list?', href: '/dashboard/inbox/32' },
    { ref: 'ask:33', kind: 'approval', title: 'Publish the Contoso Supply case study draft?', href: '/dashboard/inbox/33' },
    { ref: 'proposal:812', kind: 'proposal', title: 'Update the Acme deal stage to Proposal sent', href: '/dashboard/inbox/proposal-812' },
    { ref: 'proposal:815', kind: 'proposal', title: 'Update the Larkfield Systems close date', href: '/dashboard/inbox/proposal-815' },
  ],
};

const DECLINE: RecommendationBatch = {
  key: 'decline',
  label: 'Decline',
  count: 2,
  items: [
    { ref: 'proposal:820', kind: 'proposal', title: 'Enroll a duplicate Northwind contact', href: '/dashboard/inbox/proposal-820' },
    { ref: 'proposal:821', kind: 'proposal', title: 'Re-send last week\'s Acme follow-up', href: '/dashboard/inbox/proposal-821' },
  ],
};

function settles(result: Omit<BatchResult, 'accepted' | 'skipped' | 'failed'>): () => Promise<BatchResult> {
  return async () => {
    await new Promise(r => setTimeout(r, 600));
    return {
      ...result,
      accepted: result.results.filter(r => r.outcome === 'accepted').length,
      skipped: result.results.filter(r => r.outcome === 'skipped').length,
      failed: result.results.filter(r => r.outcome === 'failed').length,
    };
  };
}

/** Two batches; accepting either one succeeds for every item. */
export const Default: Story = {
  args: {
    batches: [APPROVE, DECLINE],
    accept: async (_key: string, refs: string[]) => settles({ results: refs.map(ref => ({ ref, title: ref, outcome: 'accepted' as const })) })(),
  },
};

/** One item changed since it was shown: the rest are accepted and the toast says which was skipped, and why. */
export const PartlySkipped: Story = {
  args: {
    batches: [APPROVE],
    accept: async (_key: string, refs: string[]) => settles({
      results: refs.map((ref, i) => (i === 0
        ? { ref, title: APPROVE.items[0]!.title, outcome: 'skipped' as const, reason: 'already approved' }
        : { ref, title: ref, outcome: 'accepted' as const })),
    })(),
  },
};

/** Nothing in view shares a recommendation: the section is not drawn at all. */
export const Empty: Story = {
  args: { batches: [] },
};
