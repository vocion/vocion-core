import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { ReviewCardRun } from './ReviewSurface';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/locales/en.json';
import { ReviewSurface } from './ReviewSurface';

/**
 * One flat template, every object type.
 *
 * Each story is a different object type rendering through the SAME shell: the
 * presenter varies on the left (title, subject, provenance, recommendation,
 * content, verbs), and the right-hand zones — header, notices, Why, Evidence,
 * the bar — are identical on every one of them. The last story is the seventh
 * row of the plan's matrix: a type nobody has built yet, landing as data alone.
 *
 * The cast is fictional (`libs/fixtures/realDataGuard.ts`) — this repository is
 * public and the unit run fails on a real identity in any story.
 */
const meta: Meta<typeof ReviewSurface> = {
  title: 'Review/ReviewSurface',
  component: ReviewSurface,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <div className="@container mx-auto max-w-5xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof ReviewSurface>;

const CRUMBS = [
  { label: 'Workspace', href: '/dashboard' },
  { label: 'Review queue', href: '/dashboard/inbox' },
  { label: 'Recommendations' },
];

/**
 * The sends of an enrollment sequence, as many as the story wants.
 * @param n
 */
const sends = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'email' as const,
    id: `send-${i + 1}`,
    label: `Day ${i * 3}`,
    subject: i === 0 ? 'Tideline\'s live-ops hiring' : `Follow-up ${i + 1}: the launch window`,
    body: i === 0
      ? 'Rowan, your careers page lists two live-ops engineers alongside the new studio launch.\n\nAre you building that team in-house, or leaning on partners to cover the launch window?'
      : `Short note ${i + 1}. The launch window is the part most studios underestimate, and it is the part a partner can absorb.\n\nWorth twenty minutes next week?`,
  }));

const enrollment = (n: number): ReviewCardRun => ({
  id: 1,
  actionId: 'personalization.enroll',
  status: 'pending',
  invokedBy: 'agent:revenue-lead',
  input: {},
  proposal: {
    confidence: 0.58,
    rationale: 'Downloaded the inbound ebook after the LinkedIn ad, and the careers page shows two live-ops roles open beside a studio launch.',
    evidence: ['https://tideline.example/careers', 'https://tideline.example/about'],
    suggestedDecision: 'approve',
    suggestedDecisionReason: 'The hiring signal is first-party and current, and the sequence already exists.',
  },
  alignment: { agreementRate: 0.82, n: 11, window: '30d' },
  card: {
    title: 'New MQL ready to enroll',
    system: 'Personalization',
    subject: { name: 'Rowan Pike', role: 'Founder & CEO', company: 'Tideline Gaming', href: '#crm' },
    provenance: [
      { label: 'Source', value: 'Paid social' },
      { label: 'Campaign', value: 'LinkedIn' },
      { label: 'Arrived', value: 'Aug 22, 2026' },
    ],
    recommendationLabel: 'Sequence to enroll',
    recommendation: {
      headline: 'Ebook Inbound Nurture',
      detail: `An existing sequence, personalized for Rowan. ${n} sends, each one leaning on the live-ops hiring rather than on the ebook download.`,
    },
    content: sends(n),
    fields: [{ label: 'On Enroll', value: `${n} sends are written to the contact's nurture slots, then the contact is enrolled` }],
    links: [{ label: 'View research', href: '/gtm/lead/88201' }],
    verbs: { approve: 'Confirm', reject: 'Decline' },
    canRegenerate: true,
  },
});

/** MQL enrollment — three sends, three tabs, plus Why and Evidence. */
export const MqlEnrollment: Story = {
  args: { run: enrollment(3), crumbs: CRUMBS, position: '28 of 224' },
};

/** Six sends: the tab row carries eight tabs without wrapping or clipping. */
export const SixSends: Story = {
  args: { run: enrollment(6), crumbs: CRUMBS, position: '28 of 224' },
};

/** Four sends — the middle of the range a real sequence lands in. */
export const FourSends: Story = {
  args: { run: enrollment(4), crumbs: CRUMBS, position: '28 of 224' },
};

/**
 * The split pane with a history behind it: what was proposed, what was asked
 * of it, and what came back. This is what the reviewer reads while writing
 * the next instruction, and what used to be gone by the time they looked.
 */
export const SendWithHistory: Story = {
  args: {
    crumbs: CRUMBS,
    position: '28 of 224',
    run: {
      ...enrollment(4),
      revisions: [
        { contentId: 'send-1', version: 1, kind: 'proposed', body: 'The first draft of send 1.', ask: 'lead with the hiring signal', at: '2026-09-17T09:12:00.000Z', by: 'revenue-lead' },
        { contentId: 'send-1', version: 2, kind: 'regenerated', body: 'The second draft of send 1.', at: '2026-09-18T14:40:00.000Z', by: 'revenue-lead' },
        { contentId: 'send-2', version: 1, kind: 'proposed', body: 'The first draft of send 2.', ask: 'shorter, and drop the apology', at: '2026-09-18T15:02:00.000Z', by: 'revenue-lead' },
      ],
    },
  },
};

/**
 * The pane squeezed to the width it gets beside an open conversation. The
 * split is a CONTAINER query, so it stacks copy-then-instruction here rather
 * than cramming two columns into a column's worth of room — and the copy is
 * still the first thing read either way.
 */
export const BesideAConversation: Story = {
  args: { run: enrollment(4), crumbs: CRUMBS, position: '28 of 224' },
  decorators: [
    Story => (
      <div className="@container max-w-xl">
        <Story />
      </div>
    ),
  ],
};

/** Follow-up email — one item, no provenance, no recommendation. Verb: Send. */
export const FollowUpEmail: Story = {
  args: {
    crumbs: CRUMBS,
    position: '3 of 12',
    run: {
      id: 3,
      actionId: 'gmail.send',
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      input: {},
      proposal: { confidence: 0.78, rationale: 'The call ended on an open question about the launch window.' },
      card: {
        title: 'SEND email → rowan@tideline.example',
        system: 'Gmail',
        subject: { name: 'rowan@tideline.example' },
        content: [{ kind: 'email', id: 'message', label: 'Email', subject: 'Yesterday\'s call', body: 'Rowan, the build-vs-partner question was the heart of yesterday\'s call.\n\nHere is the summary we promised, and one yes/no question: does Thursday work?' }],
        fields: [{ label: 'To', value: 'rowan@tideline.example' }],
        verbs: { approve: 'Send', reject: 'Decline' },
      },
    },
  },
};

/** CRM update — no content, editable properties. Changes leads the tabs. */
export const CrmUpdate: Story = {
  args: {
    crumbs: CRUMBS,
    run: {
      id: 4,
      actionId: 'hubspot.update',
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      input: { properties: { lifecyclestage: 'marketingqualifiedlead', industry: 'Games', notes: 'Two live-ops roles open beside a studio launch.' } },
      proposal: { confidence: 0.72, rationale: 'The careers page names the roles; the stage has not moved since the download.' },
      card: {
        title: 'Update HubSpot contact record',
        system: 'HubSpot CRM',
        subject: { name: 'Rowan Pike', company: 'Tideline Gaming' },
        fields: [{ label: 'Record', value: 'contacts:88201', href: '#crm' }],
        verbs: { approve: 'Update', reject: 'Decline' },
      },
    },
  },
};

/** Discovery proposal — no content at all. Why and Evidence still render. */
export const DiscoveryProposal: Story = {
  args: {
    crumbs: CRUMBS,
    run: {
      id: 5,
      actionId: 'discovery.review_proposal',
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      input: {},
      proposal: { confidence: 0.88, rationale: 'A first call walking through the platform build; clear discovery shape, proposal-ready.', evidence: ['https://zoom.example/rec/abc'] },
      card: {
        title: 'Discovery call detected: Tideline <> Metacto intro',
        system: 'Discovery',
        provenance: [
          { label: 'Call date', value: 'Aug 28, 2026' },
          { label: 'Attendees', value: 'Rowan Pike, Dana Reyes' },
        ],
        fields: [
          { label: 'Meeting', value: 'Tideline <> Metacto intro — Aug 28', href: '#zoom' },
          { label: 'Company', value: 'Tideline Gaming', href: '#crm' },
        ],
        summary: 'Proposal-ready. Approving starts the discovery follow-up mission.',
        verbs: { approve: 'Approve', reject: 'Decline' },
      },
    },
  },
};

/** Extracted candidate — a record the agent wants turned DOWN, and why. */
export const ExtractedCandidate: Story = {
  args: {
    crumbs: CRUMBS,
    run: {
      id: 6,
      actionId: 'objects.propose_candidate',
      status: 'pending',
      invokedBy: 'agent:event-scout',
      input: { properties: { title: 'Autumn Quartet Series', venue: 'Bellwater Hall', date: '2026-10-04' } },
      proposal: {
        confidence: 0.64,
        rationale: 'The listing page carries a date, a venue and a price, so the extraction itself is sound.',
        suggestedDecision: 'reject',
        suggestedDecisionReason: 'The venue is already covered by a standing listing, so this would duplicate a record the calendar already has.',
        evidence: ['https://bellwater.example/events/autumn-quartet'],
      },
      card: {
        title: 'Event candidate: Autumn Quartet Series',
        system: 'Objects',
        provenance: [{ label: 'Source document', value: 'bellwater.example · events' }],
        fields: [{ label: 'Object type', value: 'Event' }],
        verbs: { approve: 'Accept', reject: 'Reject' },
      },
    },
  },
};

/** Kit verification — two photos, a kind with no editing. Verb: Release. */
export const KitVerification: Story = {
  args: {
    crumbs: CRUMBS,
    run: {
      id: 7,
      actionId: 'qc.release_kit',
      status: 'pending',
      invokedBy: 'agent:qc-inspector',
      input: {},
      proposal: { confidence: 0.93, rationale: 'Both photos show the full kit with no missing items against the packing list.' },
      card: {
        title: 'Release this kit?',
        system: 'Vision QC',
        provenance: [
          { label: 'Inspection', value: '#4417' },
          { label: 'Kit', value: 'Radley Manufacturing · line 2' },
        ],
        recommendationLabel: 'Inspection verdict',
        recommendation: { headline: 'Release — ship it', detail: 'Every item on the packing list is present and undamaged in both frames.' },
        content: [
          { kind: 'image', id: 'photo-1', label: 'Photo 1', url: 'https://placehold.co/900x600/png', caption: 'Tray, front', findings: ['All 12 items present'] },
          { kind: 'image', id: 'photo-2', label: 'Photo 2', url: 'https://placehold.co/900x600/png', caption: 'Tray, rear' },
        ],
        fields: [],
        verbs: { approve: 'Release', reject: 'Hold' },
      },
    },
  },
};

/**
 * The seventh row of the matrix — a proposal document, an object type nobody
 * has built. It lands as a presenter's data and nothing else; every shell zone
 * above is the same one the six live types render through.
 */
export const ProposalDocument: Story = {
  args: {
    crumbs: CRUMBS,
    run: {
      id: 8,
      actionId: 'proposal.send',
      status: 'pending',
      invokedBy: 'agent:proposal-writer',
      input: {},
      proposal: { confidence: 0.91, rationale: 'Scoped from the Aug 20 discovery call; pricing follows the standard rate card.' },
      card: {
        title: 'Proposal ready to send: Tideline Gaming',
        system: 'Proposals',
        subject: { name: 'Tideline Gaming' },
        provenance: [
          { label: 'Generated from', value: 'Discovery call · Aug 20' },
          { label: 'Version', value: 'v3' },
        ],
        recommendationLabel: 'Package to send',
        recommendation: { headline: 'Platform build package', detail: 'Scope, timeline and the build package, grounded in the Aug 20 call.' },
        content: [{ kind: 'document', id: 'proposal', label: 'Proposal v3 · 12 pages', tabLabel: 'Document', href: '#open', format: 'pdf', version: 'v3', summary: 'Scope, timeline and the platform build package.' }],
        fields: [],
        verbs: { approve: 'Send', reject: 'Decline' },
      },
    },
  },
};

/** Mid-regeneration — server truth. Every control held, the instruction visible. */
export const Regenerating: Story = {
  args: {
    crumbs: CRUMBS,
    run: { ...enrollment(3), id: 9, regeneratingSince: new Date().toISOString(), regenerateNote: 'Send 2 is too pushy — soften the ask.' },
  },
};

/** The execution failed: the item keeps its error and the primary becomes Retry. */
export const ExecutionFailed: Story = {
  args: {
    crumbs: CRUMBS,
    run: { ...enrollment(3), id: 10, status: 'failed', error: 'HubSpot rejected the enrollment: the contact is already in another sequence.' },
  },
};

/** The consequence cannot be determined, so the primary is held with its reason. */
export const HeldPrimary: Story = {
  args: {
    crumbs: CRUMBS,
    run: enrollment(3),
    hold: { reason: 'The contact is already in “Q3 Outbound”, and the recommendation does not say whether this replaces it.' },
  },
};

/**
 * A hand-off — the factory asking a person to buy a domain. The card is what
 * Chris asked for after reading the first one on his phone (2026-09-20): one
 * sentence and its badges first, Approve / Reject / Snooze in words, the
 * steps numbered with a copy button on each command, Why as one section, and
 * the lifecycle under Run details saying who runs it and where it stands.
 */
export const HandOff: Story = {
  args: {
    crumbs: [CRUMBS[0]!, CRUMBS[1]!, { label: 'Approvals' }],
    run: {
      id: 781,
      actionId: 'aws.mutate',
      status: 'pending',
      invokedBy: 'agent:send-lead',
      input: {},
      proposal: {
        confidence: 0.9,
        rationale: 'The rename needs the domain before the marketing site can move, and the name is free today.',
        suggestedDecision: 'approve',
        suggestedDecisionReason: 'Fourteen dollars a year and nothing depends on it yet.',
      },
      card: {
        title: 'Register kestrel-capital.example in Route 53 for the Kestrel rename',
        system: 'Deploy',
        object: { title: 'Register kestrel-capital.example in Route 53 for the Kestrel rename', section: 'Approvals' },
        headline: 'Buy kestrel-capital.example in the acme-prod account so the marketing site can move.',
        badges: [
          { label: 'Deploy' },
          { label: 'Irreversible', tone: 'warn' },
          { label: '$14/year' },
          { label: 'AWS account acme-prod (123456789012)' },
        ],
        handoff: { reversible: false },
        summary: 'Buy kestrel-capital.example in the acme-prod account so the marketing site can move. The registration is a year at a time and cannot be refunded once it goes through.',
        contentHeading: { label: 'Recipe' },
        content: [{
          kind: 'steps',
          id: 'recipe',
          label: 'Recipe',
          steps: [
            { say: 'Register the domain in the account.', run: 'aws route53domains register-domain --domain-name kestrel-capital.example --duration-in-years 1', url: 'https://console.aws.example/route53' },
            { say: 'Wait for the registration email and confirm it.' },
            { say: 'Point the hosted zone at the marketing site.', run: 'aws route53 change-resource-record-sets --hosted-zone-id Z0FIXTURE --change-batch file://records.json' },
          ],
        }],
        fields: [],
        links: [{ label: 'Route 53 pricing', href: 'https://aws.example/route53/pricing' }],
        nextAction: 'Approving hands this to a person to do. Nothing runs here; whoever does it marks it done, and the run records who and when.',
        verbs: { approve: 'Approve', reject: 'Reject' },
      },
    },
  },
};
