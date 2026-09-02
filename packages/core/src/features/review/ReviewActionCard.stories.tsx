import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ReviewActionCard } from './ReviewActionCard';

/**
 * One template, any object, same three verbs. Each story is an object type
 * rendering through the SAME shell — absent zones collapse, verbs are
 * per-object, and the content zone is typed by kind. The document story
 * proves the proposal object lands later as one presenter registration,
 * zero shell changes.
 */
const meta: Meta<typeof ReviewActionCard> = {
  title: 'Review/ReviewActionCard',
  component: ReviewActionCard,
  parameters: { layout: 'padded' },
};

export default meta;

type Story = StoryObj<typeof ReviewActionCard>;

/** MQL enrollment — email × 3, provenance, recommendation. Verb: Enroll. */
export const MqlEnrollment: Story = {
  args: {
    run: {
      id: 1,
      actionId: 'personalization.enroll',
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      proposal: { confidence: 0.84, rationale: 'Downloaded the AI-readiness guide after the LinkedIn ad.' },
      input: {},
      card: {
        title: 'New MQL ready to enroll',
        system: 'Personalization',
        subject: { name: 'Dana Whitfield', role: 'VP Engineering', company: 'Northbeam Health' },
        provenance: [
          { label: 'Source', value: 'Paid Social · LinkedIn' },
          { label: 'Campaign', value: 'ai-readiness-q3' },
          { label: 'Became MQL', value: 'Aug 24, 2026' },
        ],
        recommendation: {
          headline: 'Enroll in: AI-Readiness Nurture · 3 sends',
          detail: 'An existing sequence, personalized for Dana. She downloaded the AI-readiness guide after the LinkedIn ad and Northbeam is hiring two platform engineers, so sends 1 and 3 reference the build-vs-buy decision directly.',
          ref: 'sequence:311',
        },
        contentHeading: { label: 'Outreach · 3 sends', meta: '9 days' },
        content: [
          { kind: 'email', id: 'send-1', label: 'Day 0', subject: 'Your platform hires and the build question', body: 'Dana, saw Northbeam is hiring platform engineers while you\'re evaluating AI tooling. That usually means a build-vs-buy call is close.\n\nWe wrote up how three teams your size decided. Worth four minutes: [link]' },
          { kind: 'email', id: 'send-2', label: 'Day 4', subject: 'The guide, one level deeper', body: 'The section most teams skip is the one on switching costs. Two paragraphs, and it usually changes the conversation.' },
          { kind: 'email', id: 'send-3', label: 'Day 9', subject: 'A 20-minute working session', body: 'If the build-vs-buy question is live, a 20-minute working session with our team usually settles it. Worth a slot next week?' },
        ],
        fields: [],
        links: [{ label: 'View Research', href: '/gtm/lead/9412' }],
        verbs: { approve: 'Enroll', reject: 'Decline' },
      },
    },
  },
};

/** Proposal review — document × 1, PDF preview + side-by-side. Verb: Send. No shell changes. */
export const ProposalReview: Story = {
  args: {
    run: {
      id: 2,
      actionId: 'proposal.send',
      status: 'pending',
      invokedBy: 'agent:proposal-writer',
      proposal: { confidence: 0.91 },
      input: {},
      card: {
        title: 'Proposal ready to send: Northbeam Health',
        system: 'Proposals',
        subject: { name: 'Northbeam Health' },
        provenance: [
          { label: 'Generated from', value: 'Discovery call · Aug 20' },
          { label: 'Version', value: 'v3' },
        ],
        recommendation: { headline: 'Send: Platform build package', detail: 'Scoped from the discovery call; pricing follows the standard rate card.' },
        contentHeading: { label: 'Document · 1' },
        content: [
          { kind: 'document', id: 'proposal', label: 'Proposal v3 · 12 pages', href: '#open', format: 'pdf', version: 'v3', summary: 'Scope, timeline and the platform build package, grounded in the Aug 20 discovery call.' },
        ],
        fields: [],
        links: [{ label: 'Grounding sources', href: '#sources' }],
        verbs: { approve: 'Send', reject: 'Decline' },
      },
    },
  },
};

/** Follow-up email — email × 1, no provenance, no recommendation. Verb: Send. */
export const FollowUpEmail: Story = {
  args: {
    run: {
      id: 3,
      actionId: 'gmail.send',
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      proposal: { confidence: 0.78 },
      input: { to: 'dana@northbeamhealth.com', subject: 'Yesterday\'s call', body: 'Dana, the build-vs-buy question was the heart of yesterday\'s call.' },
      card: {
        title: 'SEND email → dana@northbeamhealth.com',
        system: 'Gmail',
        subject: { name: 'dana@northbeamhealth.com' },
        contentHeading: { label: 'Email · 1 send' },
        content: [
          { kind: 'email', id: 'message', label: 'Send 1', subject: 'Yesterday\'s call', body: 'Dana, the build-vs-buy question was the heart of yesterday\'s call.\n\nHere\'s the summary we promised, and a yes/no question: does Thursday work for the working session?' },
        ],
        fields: [{ label: 'To', value: 'dana@northbeamhealth.com' }],
        verbs: { approve: 'Approve & send', reject: 'Reject' },
      },
    },
  },
};

/** Discovery proposal — fields only, no content zone. Verb: Approve. */
export const DiscoveryProposal: Story = {
  args: {
    run: {
      id: 4,
      actionId: 'discovery.review_proposal',
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      proposal: { confidence: 0.88 },
      input: {},
      card: {
        title: 'Discovery call detected: Northbeam <> Metacto intro',
        system: 'Discovery',
        fields: [
          { label: 'Meeting', value: 'Northbeam <> Metacto intro — Aug 28', href: '#zoom' },
          { label: 'Company', value: 'Northbeam Health', href: '#hubspot' },
        ],
        summary: 'A first call walking through the platform build; clear discovery shape, proposal-ready.',
        nextAction: 'Generate the proposal (discovery 88%, proposal-ready 82%). Approving starts the discovery follow-up mission.',
        verbs: { approve: 'Approve', reject: 'Reject' },
      },
    },
  },
};
