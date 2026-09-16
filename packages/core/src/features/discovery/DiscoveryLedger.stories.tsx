import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { DiscoveryEntry } from './DiscoveryLedger';
import { NextIntlClientProvider } from 'next-intl';
import { ListPage } from '@/components/patterns';
import { DiscoveryLedger } from './DiscoveryLedger';

/**
 * The discovery ledger on the Ledger archetype — the reference
 * implementation. Verdict chips, search and sort live in the URL.
 */
const meta: Meta<typeof DiscoveryLedger> = {
  title: 'Discovery/Ledger',
  component: DiscoveryLedger,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="mx-auto max-w-5xl">
          <ListPage title="Discovery ledger" description="Every call the detection agent assessed — what it read, how it scored, the thresholds it decided under, and what a human did with it.">
            <Story />
          </ListPage>
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof DiscoveryLedger>;

const BASE = {
  matchReason: 'Attendee jordan@acme.example matches HubSpot contact contacts:9412 (Acme Retail)',
  status: 'routed',
  thresholds: { discovery: 0.8, ready: 0.75 },
  skippedReason: null,
  classifierVersion: 'claude-haiku-4-5-20251001#discovery-v1',
  assessedBy: { agentSlug: 'revops-lead', missionRunId: 4412 },
  transcriptHash: '9f3c2a1b7e0d44c1',
  workspaceSha: 'a81f0c3e22b9d7f0',
};

const ENTRIES: DiscoveryEntry[] = [
  {
    ...BASE,
    id: 1,
    title: 'Acme <> Metacto intro',
    when: '2026-09-14T10:00:00.000Z',
    matchedAt: '2026-09-14T11:00:00.000Z',
    route: 'generate',
    classification: { isDiscovery: true, isDiscoveryConfidence: 0.95, proposalReady: true, proposalReadyConfidence: 0.88, reasoning: 'The buyer names a budget, a decision maker and a timeline, and describes the current proposal process as entirely manual across forty stores. The call ends with an explicit ask for a phased plan. Both dimensions clear their thresholds with room.' },
    reviewActionRunId: 501,
    reviewStatus: 'pending',
  },
  {
    ...BASE,
    id: 2,
    title: 'Northwind — quarterly check-in',
    when: '2026-09-14T14:30:00.000Z',
    matchedAt: '2026-09-14T15:00:00.000Z',
    matchReason: 'Attendee pat@northwind.example matches HubSpot contact contacts:7710',
    route: 'confirm',
    classification: { isDiscovery: true, isDiscoveryConfidence: 0.82, proposalReady: false, proposalReadyConfidence: 0.61, reasoning: 'A discovery conversation, but the buyer defers budget to next quarter and no decision maker is on the call.' },
    reviewActionRunId: 502,
    reviewStatus: 'approved',
  },
  {
    ...BASE,
    id: 3,
    title: 'Weekly pipeline sync',
    when: '2026-09-14T16:00:00.000Z',
    matchedAt: '2026-09-14T17:00:00.000Z',
    matchReason: 'External attendee domain example.com (Calendly)',
    status: 'dropped',
    route: 'drop',
    classification: { isDiscovery: false, isDiscoveryConfidence: 0.12, proposalReady: false, proposalReadyConfidence: 0.05, reasoning: 'An internal status meeting; no buyer, no scope, no ask.' },
    reviewActionRunId: null,
    reviewStatus: null,
  },
  {
    ...BASE,
    id: 4,
    title: 'zoom:8f1e2a9c',
    when: '2026-09-13T09:00:00.000Z',
    matchedAt: '2026-09-13T10:00:00.000Z',
    matchReason: 'Attendee domain matches HubSpot company companies:77',
    status: 'matched',
    route: null,
    classification: null,
    skippedReason: 'no-transcript',
    classifierVersion: null,
    assessedBy: null,
    transcriptHash: null,
    reviewActionRunId: null,
    reviewStatus: null,
  },
];

export const Ledger: Story = { args: { entries: ENTRIES } };
