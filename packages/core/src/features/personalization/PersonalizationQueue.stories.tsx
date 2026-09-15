import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { BriefRow } from './PersonalizationQueue';
import { NextIntlClientProvider } from 'next-intl';
import { ListPage } from '@/components/patterns';
import { PersonalizationQueue } from './PersonalizationQueue';

/**
 * The personalization queue on the List archetype — the reference
 * implementation. Lane, search and sort live in the URL.
 */
const meta: Meta<typeof PersonalizationQueue> = {
  title: 'Personalization/Queue',
  component: PersonalizationQueue,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="@container mx-auto max-w-5xl">
          <ListPage title="Personalization" description="Researched leads waiting on your decision. Each row opens the lead's page: the brief, the evidence, and the decision. Nothing here has been sent.">
            <Story />
          </ListPage>
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof PersonalizationQueue>;

function brief(over: Partial<BriefRow> & Pick<BriefRow, 'id' | 'contactName'>): BriefRow {
  return {
    contactRef: `contacts:${over.id}`,
    contactTitle: 'COO',
    companyName: 'Civic Grid',
    entranceSource: 'PAID_SOCIAL',
    utmCampaign: 'LinkedIn',
    engagementSent: 2,
    engagementOpened: 1,
    status: 'ready_for_review',
    confidence: 0.82,
    mqlAt: null,
    arrivedAt: '2026-08-24T09:00:00.000Z',
    briefedAt: '2026-08-25T10:00:00.000Z',
    ...over,
  };
}

const BRIEFS: BriefRow[] = [
  brief({ id: 88201, contactName: 'Jamie Smith', contactTitle: 'Managing Partner', companyName: 'Redpoint IT', entranceSource: 'ebook', utmCampaign: 'msp-triage', confidence: 0.88, mqlAt: '2026-09-07T12:00:00.000Z' }),
  brief({ id: 88202, contactName: 'Sean Parno', contactTitle: 'Co-founder & President', companyName: 'GLR Inc', entranceSource: 'ebook', utmCampaign: 'ai-construction', confidence: 0.86 }),
  brief({ id: 88203, contactName: 'Rosa Lindqvist', contactTitle: 'VP Operations', companyName: 'Meridian Group', confidence: 0.64, engagementOpened: 0 }),
  brief({ id: 88204, contactName: 'Pete Laverick', contactTitle: 'CEO', companyName: 'Incline Gaming Marketing Inc', confidence: 0.42, mqlAt: '2026-09-01T12:00:00.000Z' }),
  brief({ id: 88205, contactName: 'Dee Nakamura', contactTitle: 'Head of Growth', companyName: 'Orlin Health', confidence: null, entranceSource: null, utmCampaign: null, engagementSent: 0, engagementOpened: 0 }),
  brief({ id: 88206, contactName: 'Marta Kovac', companyName: 'Orlin Health', status: 'sent', confidence: 0.84 }),
  brief({ id: 88207, contactName: 'Bo Ferreira', companyName: 'Halcyon Freight', status: 'handed_off', confidence: 0.79 }),
  brief({ id: 88208, contactName: 'Anya Petrov', companyName: 'Stellar Dental', status: 'held', confidence: 0.51 }),
];

/** Opens on Review: the lane where the work is. */
export const Review: Story = { args: { briefs: BRIEFS } };

/** Nothing in the lane; the toolbar stays so the person can change lanes. */
export const EmptyLane: Story = { args: { briefs: BRIEFS.filter(b => b.status !== 'ready_for_review') } };
