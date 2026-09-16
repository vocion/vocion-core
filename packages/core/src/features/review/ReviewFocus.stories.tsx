import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { ActionRun, ReviewFocusViewProps } from './ReviewFocusView';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/locales/en.json';
import { ReviewFocusView } from './ReviewFocusView';

/**
 * The Review page in its three shapes: a presenter card (enroll), a generic
 * property update (hubspot.update) and a generic email (gmail.send). Pure
 * view — the container's data and router are stubbed as props.
 */
const meta: Meta<typeof ReviewFocusView> = {
  title: 'Review/ReviewFocus',
  component: ReviewFocusView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <div className="mx-auto max-w-5xl px-6 py-4"><Story /></div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof ReviewFocusView>;

const TYPES = [
  { actionId: 'hubspot.update', label: 'Update HubSpot record', count: 101 },
  { actionId: 'personalization.enroll', label: 'Enroll MQL in sequence', count: 82 },
  { actionId: 'discovery.review_proposal', label: 'Review discovery call → proposal', count: 20 },
  { actionId: 'gmail.send', label: 'Send email', count: 6 },
  { actionId: 'objects.propose_candidate', label: 'Propose a record for review', count: 4 },
];

const enroll: ActionRun = {
  id: 1,
  actionId: 'personalization.enroll',
  status: 'pending',
  invokedBy: 'agent:revenue-lead',
  createdAt: '2026-09-15T12:00:00Z',
  proposal: { confidence: 0.42, rationale: 'Confidence is 0.42 — the brief is thin on verifiable hooks and the contact\'s intent (client, partner, or competitor) is genuinely unknown. No email engagement recorded. Rung 2 Gentle is appropriate: restrained sends that open a conversation without over-committing to an angle that may not fit.' },
  input: {},
  card: {
    title: 'New MQL ready to enroll',
    system: 'Personalization',
    subject: { name: 'Dana Whitfield', role: 'Managing Partner', company: 'Agentix — AI Automation Agency' },
    provenance: [
      { label: 'Source', value: 'Paid social' },
      { label: 'Campaign', value: 'LinkedIn' },
      { label: 'Became MQL', value: 'Sep 15, 2026' },
    ],
    recommendation: {
      headline: 'Enroll in: Personalized Nurture · 2 Gentle · 4 sends',
      detail: 'Confidence is 0.42 — the brief is thin on verifiable hooks and the contact\'s intent (client, partner, or competitor) is genuinely unknown. No email engagement recorded. Rung 2 Gentle is appropriate: restrained sends that open a conversation without over-committing to an angle that may not fit.',
    },
    contentHeading: { label: 'Outreach · 4 sends', meta: '12 days' },
    content: [
      { kind: 'email', id: 's1', label: 'Send 1', subject: 'AI automation agencies and the build gap', body: 'Dana,\n\nSaw you\'re running Agentix alongside the platform relaunch — interesting moment to be building an AI automation practice.' },
      { kind: 'email', id: 's2', label: 'Send 2', subject: 'Re: AI automation agencies and the build gap', body: 'One more thought on the build gap…' },
      { kind: 'email', id: 's3', label: 'Send 3', subject: 'What we actually build', body: 'A short list of what we ship for agencies like yours.' },
      { kind: 'email', id: 's4', label: 'Send 4', subject: 'Leaving it here', body: 'If the timing is off, no worries — leaving it here.' },
    ],
    fields: [],
    links: [{ label: 'View Research', href: '/gtm/lead/9412' }],
    verbs: { approve: 'Enroll', reject: 'Decline' },
    nextAction: '4 sends are written to the contact\'s nurture slots, then the contact is enrolled',
    canRegenerate: true,
  },
};

const hubspotUpdate: ActionRun = {
  id: 2,
  actionId: 'hubspot.update',
  status: 'pending',
  invokedBy: 'agent:pipeline-analyst',
  createdAt: '2026-09-15T12:00:00Z',
  proposal: { confidence: 0.88, rationale: 'The Sep 14 call moved the close date; the deal stage in HubSpot still says "Proposal Sent".' },
  input: { objectType: 'deals', properties: { dealstage: 'contractsent', closedate: '2026-09-30', notes: 'Close date pushed to Sep 30 after the Sep 14 working session; contract out for signature.' } },
};

const gmailSend: ActionRun = {
  id: 3,
  actionId: 'gmail.send',
  status: 'pending',
  invokedBy: 'agent:follow-up-coordinator',
  createdAt: '2026-09-15T12:00:00Z',
  proposal: { confidence: 0.76, rationale: 'Follow-up owed since the Sep 9 proposal; no reply in six days.' },
  input: { to: 'contact@example.com', subject: 'Following up on the proposal', body: 'Hi —\n\nChecking in on the proposal we sent Sep 9. Happy to walk through any questions this week.', draft: true },
};

/**
 * A discovery assessment. The card names its own object, so the H1 is the
 * meeting ("Project Ranger – Follow Up"), the line under it says what kind of
 * record this is, and the breadcrumb reads Needs you › Discovery › <object>
 * instead of putting a generated identifier where the page's name belongs.
 * The long Up-next label beside it is what used to squeeze the H1 into ~150px.
 * Every name is a fixture.
 */
const discoveryAssessment: ActionRun = {
  id: 4,
  actionId: 'discovery.review_proposal',
  status: 'pending',
  invokedBy: 'agent:revops-lead',
  createdAt: '2026-09-14T12:00:00Z',
  proposal: { confidence: 0.95, rationale: 'The bid is due tomorrow and technical diligence is underway with two of the buyer\'s engineers on the call.' },
  input: {},
  card: {
    title: 'Project Ranger – Follow Up',
    object: {
      title: 'Project Ranger – Follow Up',
      subtitle: 'Discovery assessment · Sep 14, 11:30 AM',
      section: 'Discovery',
    },
    system: 'Discovery',
    confidenceSubject: 'Not discovery',
    recommendation: {
      headline: 'Not discovery',
      detail: 'Existing opportunity · Proposal-ready',
    },
    fields: [
      { label: 'Meeting', value: 'Project Ranger – Follow Up — Sep 14, 11:30 AM' },
      { label: 'Opportunity', value: 'Project Ranger / Northwind Health' },
      { label: 'Account', value: 'Northwind Health' },
      { label: 'Sponsor / referral source', value: 'kestrelcapital.example' },
      { label: 'Attendees', value: 'dreyes@kestrelcapital.example · lead@acme.example' },
    ],
    summary: 'Existing opportunity; diligence and bid preparation already underway.',
    nextAction: 'Mark this assessment correct. No downstream workflow runs — Vocion classified this as existing opportunity.',
    verbs: { approve: 'Approve', reject: 'Reject' },
  },
};

const base: Omit<ReviewFocusViewProps, 'current' | 'edited'> = {
  loaded: true,
  types: TYPES,
  activeTypes: [],
  onChangeTypes: () => {},
  index: 2,
  total: 213,
  upNext: [
    { id: 11, title: 'Update HubSpot deal record for the Northwind renewal', typeLabel: 'Update HubSpot record' },
    { id: 12, title: 'New MQL ready to enroll', typeLabel: 'Enroll MQL in sequence' },
    { id: 13, title: 'Send email → ops@example.com', typeLabel: 'Send email' },
  ],
  onSkipTo: () => {},
  canBack: true,
  onBack: () => {},
  onSkip: () => {},
  onSave: () => {},
  onCardDecided: () => {},
  onCardRegenerated: () => {},
  onEditField: () => {},
  steer: '',
  onSteerChange: () => {},
  onSteer: () => {},
  steering: false,
  busy: false,
  onDecide: () => {},
  snoozeOpen: false,
  onToggleSnooze: () => {},
  onSnooze: () => {},
  decided: 0,
  showHelp: false,
  onToggleHelp: () => {},
};

/** A presenter card: header, facts, recommendation, sends accordion, sticky bar with Enroll. */
export const Enroll: Story = { args: { ...base, current: enroll, edited: {} } };

/** A generic property update: why, the changes editable in place, sticky bar with Approve. */
export const HubspotUpdate: Story = {
  args: { ...base, current: hubspotUpdate, edited: { dealstage: 'contractsent', closedate: '2026-09-30', notes: 'Close date pushed to Sep 30 after the Sep 14 working session; contract out for signature.' }, activeTypes: ['hubspot.update'] },
};

/** A generic email (dry run): to/subject/body editable, Approve → draft. */
export const GmailSend: Story = {
  args: { ...base, current: gmailSend, edited: { to: 'contact@example.com', subject: 'Following up on the proposal', body: 'Hi —\n\nChecking in on the proposal we sent Sep 9. Happy to walk through any questions this week.' } },
};

/** Shortcuts hint open. */
export const WithShortcuts: Story = { args: { ...base, current: enroll, edited: {}, showHelp: true } };

/** Nothing left for the chosen type. */
export const Empty: Story = { args: { ...base, current: null, edited: {}, activeTypes: ['gmail.send'], decided: 4 } };

/**
 * The object named for a human. Also the regression guard for the H1 width
 * bug: a long Up-next label beside a title that must still get the room to
 * read as a heading (`docs/specs/discovery-ledger-v2.md` § P0).
 */
export const DiscoveryAssessment: Story = { args: { ...base, current: discoveryAssessment, edited: {} } };
