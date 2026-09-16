import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { LeadRow } from './LeadDetail';
import { NextIntlClientProvider } from 'next-intl';
import { LeadView } from './LeadDetail';

/**
 * The lead page's two states, one layout (the Detail archetype): the header
 * and the research context are constant; only the top of the content column
 * and the sticky bar change. State A decides the SAME run the review queue
 * decides; state B leads with the record of the decision already made. The
 * failure story shows the page a reviewer lands on when briefing ran out of
 * tries.
 */
const meta: Meta<typeof LeadView> = {
  title: 'Personalization/LeadPage',
  component: LeadView,
  parameters: { layout: 'padded' },
  // The back link renders through the locale-aware Link, which needs a locale.
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="@container mx-auto max-w-5xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof LeadView>;

const LEAD: LeadRow = {
  id: 42,
  contactRef: 'contacts:88201',
  contactName: 'Rowan Pike',
  contactTitle: 'CEO',
  companyName: 'Tideline Gaming Marketing Inc',
  entranceSource: 'PAID_SOCIAL',
  utmCampaign: 'LinkedIn',
  engagementSent: 2,
  engagementOpened: 1,
  status: 'ready_for_review',
  confidence: 0.6,
  sections: [
    { heading: 'Prospect', body: 'Rowan Pike, CEO at Tideline Gaming Marketing Inc — an iGaming affiliate marketing agency.' },
    { heading: 'Research That Matters', body: 'The agency publishes state-by-state compliance updates, which suggests the compliance workload is in-house and manual.' },
    { heading: 'Recommended Angle', body: 'Ask how the team keeps affiliate compliance current across states.' },
  ],
  claims: [
    { text: 'Runs an iGaming affiliate marketing agency.', kind: 'Fact', source: 'https://tideline.example/about', date: '2026-08-30' },
    { text: 'Compliance tracking is the likely pain point.', kind: 'Inference', source: 'https://tideline.example/compliance' },
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
  handoffSections: [],
  handoffTrigger: null,
  handoffAt: null,
};

const HUBSPOT = 'https://app.hubspot.com/contacts/12345/record/0-1/88201';

/** State A: a decision is waiting. The card sits on top, context below and beside it. */
export const DecisionWaiting: Story = {
  args: {
    lead: LEAD,
    contactHref: HUBSPOT,
    onDecided: () => {},
    runState: {
      snoozedUntil: null,
      runFailed: false,
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
          subject: { name: 'Rowan Pike', role: 'CEO', company: 'Tideline Gaming Marketing Inc', href: HUBSPOT },
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
  },
};

/**
 * State A beside the conversation: the guided review in the dock owns the
 * rewrite, so the sends read as text; the sticky bar still decides.
 */
export const DecisionWaitingGuided: Story = {
  args: { ...DecisionWaiting.args, guided: true },
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
    runState: { run: null, snoozedUntil: null, runFailed: false },
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
    runState: { run: null, snoozedUntil: null, runFailed: false },
    onDecided: () => {},
  },
};
