import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { LeadRow } from './LeadDetail';
import { NextIntlClientProvider } from 'next-intl';
import { computeConfidenceDimensions } from '@/services/personalization/confidence';
import { LeadView } from './LeadDetail';

/**
 * The lead workspace, rebuilt to `docs/specs/personalization-v2.md`.
 *
 * One layout in every state: header, ONE recommendation block carrying the
 * sequence-state reconciliation, then Brief · Sequence · Evidence. The
 * permanent metadata column is gone. The stories are ordered by the review's
 * own priorities — the ambiguous sequence state first, because it is the one
 * that holds the button.
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

const DIMENSIONS = computeConfidenceDimensions({
  contactName: 'Rowan Pike',
  contactTitle: 'CEO',
  companyName: 'Tideline Gaming Marketing Inc',
  entranceSource: 'PAID_SOCIAL',
  utmCampaign: 'LinkedIn',
  mqlAt: '2026-09-01T12:00:00.000Z',
  engagementSent: 2,
  engagementOpened: 1,
  claims: [{ kind: 'company', source: 'https://tideline.example/about' }],
});

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
  confidenceDimensions: DIMENSIONS,
  sections: [
    { heading: 'Prospect', body: 'Rowan Pike, CEO at Tideline Gaming Marketing Inc — an iGaming affiliate marketing agency.' },
    { heading: 'Research That Matters', body: 'The agency publishes state-by-state compliance updates, which suggests the compliance workload is in-house and manual.' },
    { heading: 'Recommended Angle', body: 'Ask how the team keeps affiliate compliance current across states.' },
    { heading: 'Opening Question', body: 'How do you keep affiliate compliance current across states today?' },
    { heading: 'CRM Context', body: 'Enrolled in an automated nurture within minutes of becoming an MQL.' },
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
    { step: 1, day: 0, subject: 'The ebook you pulled', body: 'Following up on the ebook — the state-by-state compliance section is the one most agencies act on first.' },
    { step: 2, day: 4, subject: 'One level deeper', body: 'The compliance tracker walkthrough, if useful.' },
  ],
  recommendedSequence: { id: 'seq-311', name: 'Ebook Inbound Sequence' },
  currentSequence: { id: 'seq-auto', name: 'MQL Auto-Nurture', status: 'active', kind: 'automated', step: 1, totalSteps: 3, observedAt: '2026-09-01T12:04:00.000Z', source: 'hubspot' },
  reviewActionRunId: 501,
  draftError: null,
  mqlAt: '2026-09-01T12:00:00.000Z',
  arrivedAt: '2026-08-29T09:00:00.000Z',
  briefedAt: '2026-09-01T14:00:00.000Z',
  decidedAt: null,
  decidedBy: null,
  briefVersion: 'claude-sonnet-4-6#personalization-v1',
  workspaceSha: 'a1b2c3d',
  handoffSections: [],
  handoffTrigger: null,
  handoffAt: null,
};

const ARTIFACTS = [
  { role: 'brief' as const, id: 11, title: 'Rowan Pike — research brief', version: 3, kind: 'markdown', ref: { type: 'artifact' as const, id: '11', label: 'Rowan Pike — research brief', href: '/dashboard/artifacts/11' } },
  { role: 'recommendation' as const, id: 12, title: 'Rowan Pike — outreach recommendation', version: 1, kind: 'markdown', ref: { type: 'artifact' as const, id: '12', label: 'Rowan Pike — outreach recommendation', href: '/dashboard/artifacts/12' } },
  { role: 'sequence' as const, id: 13, title: 'Rowan Pike — Ebook Inbound Sequence', version: 2, kind: 'sequence', ref: { type: 'artifact' as const, id: '13', label: 'Rowan Pike — Ebook Inbound Sequence', href: '/dashboard/artifacts/13' } },
];

const HUBSPOT = 'https://app.hubspot.com/contacts/12345/record/0-1/88201';

const RUN = {
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
    provenance: [],
    recommendation: { headline: 'Enroll in Ebook Inbound Sequence · 2 sends', detail: 'Identity and company context are established, but nothing specific enough to open on — lead with the category.', ref: 'seq-311' },
    // `Day N`, not `Send N` — `personalization-enroll.ts` labels a send by its
    // day offset whenever it has one, and every seeded send has one. A story
    // that hand-writes a different label shows a product that does not exist,
    // which is how the two send-label paths drifted unnoticed.
    content: [
      { kind: 'email', id: 'send-1', label: 'Day 0', subject: 'The ebook you pulled', body: 'Following up on the ebook — the state-by-state compliance section is the one most agencies act on first.' },
      { kind: 'email', id: 'send-2', label: 'Day 4', subject: 'One level deeper', body: 'The compliance tracker walkthrough, if useful.' },
    ],
    fields: [],
    verbs: { approve: 'Enroll', reject: 'Decline' },
  },
};

/**
 * The first screen: header, the recommendation, and the sequence-state block
 * saying that approving REPLACES the automated nurture the CRM enrolled them
 * in. That reconciliation is the P0 the old page had no way to express.
 */
export const DecisionWaiting: Story = {
  args: {
    lead: LEAD,
    artifacts: ARTIFACTS,
    contactHref: HUBSPOT,
    onDecided: () => {},
    runState: { snoozedUntil: null, runFailed: false, pinned: [], run: RUN as never },
  },
};

/**
 * The case the review said must never reach a one-click Enroll: the contact is
 * in a sequence somebody chose, and nothing says whether the recommendation
 * replaces it or runs alongside it. The block says so and the primary is held.
 */
export const SequenceStateAmbiguous: Story = {
  args: {
    ...DecisionWaiting.args,
    lead: { ...LEAD, currentSequence: { name: 'Inbound Follow-up', status: 'active', kind: 'manual', step: 1, totalSteps: 3 } },
  },
};

/** Never observed at all — the honest fourth answer, and the same hold. */
export const SequenceStateUnknown: Story = {
  args: { ...DecisionWaiting.args, lead: { ...LEAD, currentSequence: null } },
};

/**
 * Beside the conversation: the rail owns the per-send rewrite, so the sends
 * read as text; the sticky bar still decides (#378).
 */
export const DecisionWaitingGuided: Story = {
  args: { ...DecisionWaiting.args, guided: true },
};

/** No decision waiting. Same page; the recommendation block carries the record. */
export const DecidedRecord: Story = {
  args: {
    lead: { ...LEAD, status: 'handed_off', decidedAt: '2026-09-01T16:00:00.000Z', decidedBy: 'reviewer@example.com' },
    artifacts: ARTIFACTS,
    contactHref: HUBSPOT,
    runState: { run: null, snoozedUntil: null, runFailed: false, pinned: [{ artifactId: 11, role: 'brief', version: 3, title: 'Rowan Pike — research brief' }, { artifactId: 13, role: 'sequence', version: 2, title: 'Rowan Pike — Ebook Inbound Sequence' }] },
    onDecided: () => {},
  },
};

/** The tries ran out: the error stands where the brief would be, Regenerate at hand. */
export const BriefingFailed: Story = {
  args: {
    lead: {
      ...LEAD,
      confidence: null,
      confidenceDimensions: null,
      sections: [],
      claims: [],
      missing: [],
      draftSequence: [],
      recommendedSequence: null,
      currentSequence: null,
      reviewActionRunId: null,
      briefAttempts: 3,
      briefError: 'web_search returned "search provider unconfigured" on every query.',
    },
    artifacts: [],
    contactHref: HUBSPOT,
    runState: { run: null, snoozedUntil: null, runFailed: false, pinned: [] },
    onDecided: () => {},
  },
};
