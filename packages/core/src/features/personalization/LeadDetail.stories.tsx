import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { LeadRow } from './LeadDetail';
import { NextIntlClientProvider } from 'next-intl';
import { LeadView } from './LeadDetail';

/**
 * The lead page's two states, one layout: the header and the research context
 * are constant; only the top of the main column changes. State A leads with
 * the decidable card (the SAME run the review queue decides); state B leads
 * with the record of the decision already made. The failure story shows the
 * page a reviewer lands on when briefing ran out of tries.
 */
const meta: Meta<typeof LeadView> = {
  title: 'Personalization/LeadPage',
  component: LeadView,
  parameters: { layout: 'padded' },
  // The back link renders through the locale-aware Link, which needs a locale.
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof LeadView>;

const LEAD: LeadRow = {
  id: 42,
  contactRef: 'contacts:88201',
  contactName: 'Pete Laverick',
  contactTitle: 'CEO',
  companyName: 'Incline Gaming Marketing Inc',
  entranceSource: 'PAID_SOCIAL',
  utmCampaign: 'LinkedIn',
  engagementSent: 2,
  engagementOpened: 1,
  status: 'ready_for_review',
  confidence: 0.6,
  sections: [
    { heading: 'Prospect', body: 'Pete Laverick, CEO at Incline Gaming Marketing Inc — an iGaming affiliate marketing agency.' },
    { heading: 'Research That Matters', body: 'The agency publishes state-by-state compliance updates, which suggests the compliance workload is in-house and manual.' },
    { heading: 'Recommended Angle', body: 'Ask how the team keeps affiliate compliance current across states.' },
  ],
  claims: [
    { text: 'Runs an iGaming affiliate marketing agency.', kind: 'Fact', source: 'https://incline.bet/about', date: '2026-08-30' },
    { text: 'Compliance tracking is the likely pain point.', kind: 'Inference', source: 'https://incline.bet/compliance' },
  ],
  missing: ['No public team size.'],
  briefError: null,
  briefAttempts: 1,
  regenerateNote: null,
  draftSequence: [
    { step: 1, day: 0, subject: 'The ebook you pulled', body: 'Pete, following up on the LinkedIn ebook — the state-by-state compliance section is the one most agencies act on first.' },
    { step: 2, day: 4, subject: 'One level deeper', body: 'The compliance tracker walkthrough, if useful.' },
  ],
  recommendedSequence: { id: 'seq-311', name: 'LinkedIn Ebook Inbound Sequence' },
  reviewActionRunId: 501,
  draftError: null,
  mqlAt: '2026-09-01T12:00:00.000Z',
  arrivedAt: '2026-08-29T09:00:00.000Z',
  briefedAt: '2026-09-01T14:00:00.000Z',
  decidedAt: null,
  decidedBy: null,
};

const HUBSPOT = 'https://app.hubspot.com/contacts/12345/record/0-1/88201';

/** State A: a decision is waiting. The card sits on top, context below and beside it. */
export const DecisionWaiting: Story = {
  args: {
    lead: LEAD,
    contactHref: HUBSPOT,
    pendingResolved: true,
    onDecided: () => {},
    run: {
      id: 501,
      actionId: 'personalization.enroll',
      status: 'pending',
      input: {},
      invokedBy: 'agent:revenue-lead',
      proposal: { confidence: 0.6 },
      card: {
        title: 'New MQL ready to enroll',
        system: 'Personalization',
        subject: { name: 'Pete Laverick', role: 'CEO', company: 'Incline Gaming Marketing Inc', href: HUBSPOT },
        provenance: [
          { label: 'Source', value: 'Paid social' },
          { label: 'Campaign', value: 'LinkedIn' },
          { label: 'Became MQL', value: 'Sep 1, 2026' },
        ],
        recommendation: { headline: 'Enroll in: LinkedIn Ebook Inbound Sequence · 2 sends', ref: 'seq-311' },
        contentHeading: { label: 'Outreach · 2 sends', meta: '4 days' },
        content: [
          { kind: 'email', id: 'send-1', label: 'Day 0', subject: 'The ebook you pulled', body: 'Pete, following up on the LinkedIn ebook — the state-by-state compliance section is the one most agencies act on first.' },
          { kind: 'email', id: 'send-2', label: 'Day 4', subject: 'One level deeper', body: 'The compliance tracker walkthrough, if useful.' },
        ],
        fields: [],
        links: [{ label: 'View Research', href: '/gtm/lead/88201' }],
        verbs: { approve: 'Enroll', reject: 'Decline' },
      },
    },
  },
};

/** State B: no decision waiting. Same page, the decision zone becomes the record. */
export const DecidedRecord: Story = {
  args: {
    lead: {
      ...LEAD,
      status: 'handed_off',
      decidedAt: '2026-09-01T16:00:00.000Z',
      decidedBy: 'jamie@metacto.com',
    },
    contactHref: HUBSPOT,
    run: undefined,
    pendingResolved: true,
    onDecided: () => {},
  },
};

/** The tries ran out: the error stands where the brief would be, Regenerate at hand. */
export const BriefingFailed: Story = {
  args: {
    lead: {
      ...LEAD,
      confidence: null,
      sections: [],
      claims: [],
      missing: [],
      draftSequence: [],
      recommendedSequence: null,
      reviewActionRunId: null,
      briefAttempts: 3,
      briefError: 'web_search returned "search provider unconfigured" on every query.',
    },
    contactHref: HUBSPOT,
    run: undefined,
    pendingResolved: true,
    onDecided: () => {},
  },
};
