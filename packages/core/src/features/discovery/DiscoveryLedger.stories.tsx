import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { DiscoveryEntry } from './DiscoveryLedger';
import { NextIntlClientProvider } from 'next-intl';
import { ListPage } from '@/components/patterns';
import { DiscoveryLedger } from './DiscoveryLedger';

/**
 * The Discovery Ledger, rebuilt to `docs/specs/discovery-ledger-v2.md`. The
 * header's counts filter the ledger; Decision / Human review / Reason are
 * three independent dimensions; the model's internals are behind
 * "Evidence & decision details".
 *
 * Every name here is a fixture.
 */
const meta: Meta<typeof DiscoveryLedger> = {
  title: 'Discovery/Ledger',
  component: DiscoveryLedger,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <ListPage title="Discovery ledger" description="Every call the detection agent assessed — what it decided, why, and what you did with it.">
          <Story />
        </ListPage>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof DiscoveryLedger>;

const BASE = {
  status: 'routed',
  thresholds: { discovery: 0.6, ready: 0.75 },
  skippedReason: null,
  classifierVersion: 'claude-haiku-4-5-20251001#discovery-v2',
  assessedBy: { agentSlug: 'revops-lead', missionRunId: 4412 },
  transcriptHash: '9f3c2a1b7e0d44c1',
  workspaceSha: 'a81f0c3e22b9d7f0',
  humanDecidedBy: null,
};

const NORTHWIND = {
  opportunity: { label: 'Project Ranger / Northwind Health', ref: 'deals:1201' },
  account: { label: 'Northwind Health', ref: 'deals:1201' },
  accountResolved: true,
  unresolvedKnown: null,
  sponsorDomain: 'kestrelcapital.example',
  attendees: [
    { email: 'dreyes@kestrelcapital.example', external: true },
    { email: 'lead@acme.example', external: false },
  ],
};

const ENTRIES: DiscoveryEntry[] = [
  // The spec's first worked example.
  {
    ...BASE,
    id: 1,
    title: 'Project Ranger – Follow Up',
    meetingExternalId: 'zoom:7c41',
    when: '2026-09-14T11:30:00.000Z',
    matchedAt: '2026-09-14T12:00:00.000Z',
    classifiedAt: '2026-09-14T12:05:00.000Z',
    matchReason: 'Attendee matches HubSpot deal deals:1201',
    status: 'routed',
    route: 'drop',
    recommendedAction: 'no-action',
    classification: {
      semantics: 'stated-class',
      classification: 'not-discovery',
      classificationConfidence: 0.95,
      proposalReadiness: 'proposal-ready',
      proposalReadinessConfidence: 0.82,
      reasonCode: 'existing-opportunity',
      reasonCodeFallback: false,
      reasonSummary: 'Existing opportunity; diligence and bid preparation already underway.',
      reasoning: 'The prospect is already identified and the bid is due tomorrow. Technical diligence is underway with two of the buyer’s engineers on the call, and the conversation is about evidence for a decision already in flight rather than about discovering a need.',
    },
    disposition: 'pending',
    humanDecision: null,
    entities: NORTHWIND,
    reviewActionRunId: 501,
    reviewStatus: 'pending',
  },
  // The spec's second worked example — the disagreement.
  {
    ...BASE,
    id: 2,
    title: 'Growth Strategy call',
    meetingExternalId: 'zoom:8a12',
    when: '2026-09-14T16:30:00.000Z',
    matchedAt: '2026-09-14T17:00:00.000Z',
    classifiedAt: '2026-09-14T17:04:00.000Z',
    matchReason: 'Attendee matches HubSpot contact contacts:7710',
    route: 'generate',
    recommendedAction: 'generate-proposal',
    classification: {
      semantics: 'stated-class',
      classification: 'discovery',
      classificationConfidence: 0.92,
      proposalReadiness: 'proposal-ready',
      proposalReadinessConfidence: 0.88,
      reasonCode: 'first-sales-conversation',
      reasonCodeFallback: false,
      reasonSummary: 'Buyer needs, revenue goals and sales-process constraints discussed.',
      reasoning: 'A first conversation with a new buyer. Revenue goals, the current sales process and two named constraints are all covered, and the call ends with an explicit ask for a phased plan.',
    },
    disposition: 'corrected',
    humanDecision: 'rejected',
    humanDecidedBy: 'rev-lead',
    entities: {
      opportunity: null,
      account: { label: 'Kestrel Capital', ref: 'contacts:7710' },
      accountResolved: true,
      unresolvedKnown: null,
      sponsorDomain: null,
      attendees: [{ email: 'dreyes@kestrelcapital.example', external: true }],
    },
    reviewActionRunId: 502,
    reviewStatus: 'rejected',
  },
  // Uncertain — a real class, routed to a person rather than dropped.
  {
    ...BASE,
    id: 3,
    title: 'Intro — referred by Kestrel Capital',
    meetingExternalId: 'granola:4d19',
    when: '2026-09-14T09:15:00.000Z',
    matchedAt: '2026-09-14T09:45:00.000Z',
    classifiedAt: '2026-09-14T09:50:00.000Z',
    matchReason: 'Seller-hosted call with external attendee (kestrelcapital.example)',
    route: 'confirm',
    recommendedAction: 'continue-discovery',
    classification: {
      semantics: 'stated-class',
      classification: 'uncertain',
      classificationConfidence: 0.44,
      proposalReadiness: 'uncertain',
      proposalReadinessConfidence: 0.3,
      reasonCode: 'insufficient-evidence',
      reasonCodeFallback: false,
      reasonSummary: 'Twelve minutes of introductions; no need or scope discussed.',
      reasoning: 'The call is almost entirely introductions and scheduling. Nothing in the transcript establishes a need, a buying process or a decision maker either way.',
    },
    disposition: 'accepted',
    humanDecision: 'approved',
    humanDecidedBy: 'rev-lead',
    entities: {
      opportunity: null,
      account: null,
      accountResolved: false,
      unresolvedKnown: 'dreyes@kestrelcapital.example',
      sponsorDomain: 'kestrelcapital.example',
      attendees: [{ email: 'dreyes@kestrelcapital.example', external: true }],
    },
    reviewActionRunId: 503,
    reviewStatus: 'approved',
  },
  // A row written before the contract existed: verdict readable, number not.
  {
    ...BASE,
    id: 4,
    title: 'Weekly pipeline sync',
    meetingExternalId: 'zoom:2b77',
    when: '2026-09-13T16:00:00.000Z',
    matchedAt: '2026-09-13T17:00:00.000Z',
    classifiedAt: '2026-09-13T17:02:00.000Z',
    matchReason: 'External attendee domain example.com (Calendly)',
    status: 'dropped',
    route: 'drop',
    recommendedAction: 'no-action',
    classifierVersion: 'claude-haiku-4-5-20251001#discovery-v1',
    classification: {
      semantics: 'legacy',
      classification: 'not-discovery',
      classificationConfidence: null,
      proposalReadiness: 'not-proposal-ready',
      proposalReadinessConfidence: null,
      reasonCode: null,
      reasonCodeFallback: false,
      reasonSummary: '',
      reasoning: 'An internal status meeting; no buyer, no scope, no ask.',
      legacyScores: { isDiscoveryConfidence: 0.12, proposalReadyConfidence: 0.05 },
    },
    disposition: 'dismissed',
    humanDecision: null,
    entities: {
      opportunity: null,
      account: null,
      accountResolved: false,
      unresolvedKnown: 'example.com',
      sponsorDomain: 'example.com',
      attendees: [],
    },
    reviewActionRunId: 504,
    reviewStatus: 'cancelled',
  },
  // A second v1 row, accepted — so the header can compare this model version
  // against the previous one. Without decided rows on both, the delta is not
  // shown at all rather than shown against an invented baseline.
  {
    ...BASE,
    id: 6,
    title: 'Fabrikam — scoping call',
    meetingExternalId: 'zoom:5c08',
    when: '2026-09-13T13:00:00.000Z',
    matchedAt: '2026-09-13T13:30:00.000Z',
    classifiedAt: '2026-09-13T13:31:00.000Z',
    matchReason: 'Attendee domain matches HubSpot company companies:77',
    classifierVersion: 'claude-haiku-4-5-20251001#discovery-v1',
    route: 'confirm',
    recommendedAction: 'continue-discovery',
    classification: {
      semantics: 'legacy',
      classification: 'discovery',
      classificationConfidence: null,
      proposalReadiness: 'not-proposal-ready',
      proposalReadinessConfidence: null,
      reasonCode: null,
      reasonCodeFallback: false,
      reasonSummary: '',
      reasoning: 'A scoping conversation; the buyer defers budget to next quarter.',
      legacyScores: { isDiscoveryConfidence: 0.81, proposalReadyConfidence: 0.42 },
    },
    disposition: 'accepted',
    humanDecision: 'approved',
    humanDecidedBy: 'rev-lead',
    entities: {
      opportunity: null,
      account: { label: 'Fabrikam Logistics', ref: 'companies:77' },
      accountResolved: true,
      unresolvedKnown: null,
      sponsorDomain: null,
      attendees: [],
    },
    reviewActionRunId: 505,
    reviewStatus: 'approved',
  },
  // Matched, never assessed — the coverage record, still a row.
  {
    ...BASE,
    id: 5,
    title: 'zoom:8f1e2a9c',
    meetingExternalId: 'zoom:8f1e2a9c',
    when: '2026-09-13T09:00:00.000Z',
    matchedAt: '2026-09-13T10:00:00.000Z',
    classifiedAt: null,
    matchReason: 'Attendee domain matches HubSpot company companies:77',
    status: 'matched',
    route: null,
    recommendedAction: null,
    classification: null,
    disposition: 'pending',
    humanDecision: null,
    skippedReason: 'no-transcript',
    classifierVersion: null,
    assessedBy: null,
    transcriptHash: null,
    entities: {
      opportunity: null,
      account: { label: 'Fabrikam Logistics', ref: 'companies:77' },
      accountResolved: true,
      unresolvedKnown: null,
      sponsorDomain: null,
      attendees: [],
    },
    reviewActionRunId: null,
    reviewStatus: null,
  },
];

export const Ledger: Story = { args: { entries: ENTRIES } };

/** The hero capability: the rows a person overrode. */
export const Disagreements: Story = {
  args: { entries: ENTRIES.filter(e => e.disposition === 'corrected') },
};
