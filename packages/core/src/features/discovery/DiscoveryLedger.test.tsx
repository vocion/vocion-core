import type { DiscoveryEntry } from './DiscoveryLedger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { DiscoveryLedger } from './DiscoveryLedger';

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard',
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

/**
 * What this page is for, asserted: a person can read a verdict with the class
 * it belongs to, tell the three dimensions apart, find the disagreements in
 * one click, and never be shown a percentage the system cannot justify.
 *
 * Every name here is a fixture (`docs/specs/discovery-ledger-v2.md`).
 */

const BASE = {
  status: 'routed',
  thresholds: { discovery: 0.6, ready: 0.75 },
  skippedReason: null,
  classifierVersion: 'model#discovery-v2',
  assessedBy: { agentSlug: 'revops-lead' },
  transcriptHash: '9f3c2a1b7e0d44c1',
  workspaceSha: 'a81f0c3e22b9d7f0',
  humanDecidedBy: null,
  matchReason: 'Attendee matches HubSpot deal deals:1201',
  entities: {
    opportunity: { label: 'Project Ranger / Northwind Health', ref: 'deals:1201' },
    account: { label: 'Northwind Health', ref: 'deals:1201' },
    accountResolved: true,
    unresolvedKnown: null,
    sponsorDomain: null,
    attendees: [],
  },
};

const NOT_DISCOVERY: DiscoveryEntry = {
  ...BASE,
  id: 1,
  title: 'Project Ranger – Follow Up',
  meetingExternalId: 'zoom:1',
  when: '2026-09-14T11:30:00.000Z',
  matchedAt: '2026-09-14T12:00:00.000Z',
  classifiedAt: '2026-09-14T12:01:00.000Z',
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
    reasoning: 'The bid is due tomorrow and technical diligence is underway.',
  },
  disposition: 'pending',
  humanDecision: null,
  reviewActionRunId: 501,
  reviewStatus: 'pending',
};

const CORRECTED: DiscoveryEntry = {
  ...BASE,
  id: 2,
  title: 'Growth Strategy call',
  meetingExternalId: 'zoom:2',
  when: '2026-09-14T16:30:00.000Z',
  matchedAt: '2026-09-14T17:00:00.000Z',
  classifiedAt: '2026-09-14T17:01:00.000Z',
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
    reasonSummary: 'Buyer needs and revenue goals discussed.',
    reasoning: 'A first conversation with a new buyer.',
  },
  disposition: 'corrected',
  humanDecision: 'rejected',
  humanDecidedBy: 'rev-lead',
  reviewActionRunId: 502,
  reviewStatus: 'rejected',
};

const LEGACY: DiscoveryEntry = {
  ...BASE,
  id: 3,
  title: 'Weekly pipeline sync',
  meetingExternalId: 'zoom:3',
  when: '2026-09-13T16:00:00.000Z',
  matchedAt: '2026-09-13T17:00:00.000Z',
  classifiedAt: '2026-09-13T17:01:00.000Z',
  classifierVersion: 'model#discovery-v1',
  route: 'drop',
  recommendedAction: 'no-action',
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
  disposition: 'accepted',
  humanDecision: 'approved',
  reviewActionRunId: 503,
  reviewStatus: 'approved',
};

const UNRESOLVED: DiscoveryEntry = {
  ...BASE,
  id: 4,
  title: 'Intro call',
  meetingExternalId: 'granola:4',
  when: '2026-09-13T09:00:00.000Z',
  matchedAt: '2026-09-13T09:30:00.000Z',
  classifiedAt: '2026-09-13T09:31:00.000Z',
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
    reasonSummary: 'Introductions only; no need or scope discussed.',
    reasoning: 'Almost entirely introductions and scheduling.',
  },
  disposition: 'pending',
  humanDecision: null,
  entities: {
    opportunity: null,
    account: null,
    accountResolved: false,
    unresolvedKnown: 'dreyes@kestrelcapital.example',
    sponsorDomain: 'kestrelcapital.example',
    attendees: [{ email: 'dreyes@kestrelcapital.example', external: true }],
  },
  reviewActionRunId: null,
  reviewStatus: null,
};

const ENTRIES = [NOT_DISCOVERY, CORRECTED, LEGACY, UNRESOLVED];

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('the score always travels with its class', () => {
  it('reads "Not discovery 95%", never "discovery 0.95" on a row that says the opposite', async () => {
    await render(<DiscoveryLedger entries={[NOT_DISCOVERY]} />);

    await expect.element(page.getByText('Not discovery 95%')).toBeInTheDocument();
    // The class is also in the accessible name, for anyone reading the bars.
    await expect.element(page.getByLabelText('Not discovery — 95% confidence (confident)')).toBeInTheDocument();
    await expect.element(page.getByText('Proposal-ready 82%')).toBeInTheDocument();
  });

  it('shows a legacy row\'s VERDICT with no percentage at all', async () => {
    await render(<DiscoveryLedger entries={[LEGACY]} />);

    await expect.element(page.getByTestId('decision')).toHaveTextContent('Not discovery');
    await expect.element(page.getByTestId('legacy-confidence')).toBeInTheDocument();
    // Nothing on the row asserts a probability the system cannot justify.
    expect(document.body.textContent).not.toContain('12%');
    expect(document.body.textContent).not.toContain('0.12');
  });

  it('keeps the raw legacy numbers, labelled as uninterpretable, behind the disclosure', async () => {
    await render(<DiscoveryLedger entries={[LEGACY]} />);
    await userEvent.click(page.getByTestId('ledger-details-toggle'));

    const details = page.getByTestId('ledger-details');

    await expect.element(details).toHaveTextContent('is_discovery_confidence 0.12');
    await expect.element(details).toHaveTextContent('Unknown');
  });
});

describe('the thresholds are not row-level hierarchy', () => {
  it('keeps them out of the row and inside Evidence & decision details', async () => {
    await render(<DiscoveryLedger entries={[NOT_DISCOVERY]} />);

    expect(document.body.textContent).not.toContain('class ≥ 0.6');

    await userEvent.click(page.getByTestId('ledger-details-toggle'));

    await expect.element(page.getByTestId('ledger-details')).toHaveTextContent('class ≥ 0.6 · readiness ≥ 0.75');
  });
});

describe('three dimensions, never collapsed', () => {
  it('states classification, agent action and human review separately on the row', async () => {
    await render(<DiscoveryLedger entries={[NOT_DISCOVERY]} />);

    await expect.element(page.getByTestId('decision')).toHaveTextContent('Not discovery');
    await expect.element(page.getByText('No discovery workflow')).toBeInTheDocument();
    await expect.element(page.getByTestId('disposition')).toHaveTextContent('Pending');
  });

  it('offers one control per dimension, not one control for all three', async () => {
    await render(<DiscoveryLedger entries={ENTRIES} />);

    await expect.element(page.getByRole('combobox', { name: 'Decision' })).toBeInTheDocument();
    await expect.element(page.getByRole('combobox', { name: 'Human review' })).toBeInTheDocument();
    await expect.element(page.getByRole('combobox', { name: 'Reason' })).toBeInTheDocument();
  });
});

describe('disagreements are the hero', () => {
  it('counts assessed / need review / corrected in the header with the agreement rate', async () => {
    await render(<DiscoveryLedger entries={ENTRIES} />);

    await expect.element(page.getByTestId('count-assessed')).toHaveTextContent('4 assessed');
    await expect.element(page.getByTestId('count-need-review')).toHaveTextContent('2 need review');
    await expect.element(page.getByTestId('count-corrected')).toHaveTextContent('1 corrected');
    // 1 accepted of 2 decided.
    await expect.element(page.getByTestId('agreement-rate')).toHaveTextContent('50% agreement');
  });

  it('filters the ledger the moment the corrected count is clicked', async () => {
    await render(<DiscoveryLedger entries={ENTRIES} />);
    await userEvent.click(page.getByTestId('count-corrected'));

    const rows = page.getByTestId('discovery-entry').elements();

    expect(rows).toHaveLength(1);
    await expect.element(page.getByText('Growth Strategy call')).toBeInTheDocument();
  });

  it('lands a clicked count on exactly the set the number promised', async () => {
    // A matched call with no transcript is `pending` too, but it waits on a
    // transcript rather than on a person. The count and the filter use one
    // predicate, so clicking "1 need review" cannot land on two rows.
    const unassessed = { ...NOT_DISCOVERY, id: 9, title: 'zoom:not-yet-read', classification: null, route: null, recommendedAction: null, skippedReason: 'no-transcript', reviewActionRunId: null, reviewStatus: null } as DiscoveryEntry;
    await render(<DiscoveryLedger entries={[NOT_DISCOVERY, unassessed]} />);

    await expect.element(page.getByTestId('count-need-review')).toHaveTextContent('1 need review');

    await userEvent.click(page.getByTestId('count-need-review'));

    expect(page.getByTestId('discovery-entry').elements()).toHaveLength(1);
    await expect.element(page.getByText('Project Ranger – Follow Up')).toBeInTheDocument();
  });

  it('has a first-class quick filter for them too', async () => {
    await render(<DiscoveryLedger entries={ENTRIES} />);
    await userEvent.click(page.getByRole('button', { name: /Human disagreed/ }));

    expect(page.getByTestId('discovery-entry').elements()).toHaveLength(1);
  });

  it('reports the delta against the previous model version when there is one', async () => {
    await render(<DiscoveryLedger entries={ENTRIES} />);

    // v2: 1 corrected of 1 decided (0%). v1: 1 accepted of 1 decided (100%).
    await expect.element(page.getByTestId('version-delta')).toHaveTextContent('-100 pts vs previous model version');
  });
});

describe('entities', () => {
  it('names the opportunity when the CRM resolved one', async () => {
    await render(<DiscoveryLedger entries={[NOT_DISCOVERY]} />);

    await expect.element(page.getByText('Project Ranger / Northwind Health')).toBeInTheDocument();
  });

  it('says "Account not resolved" with what IS known, rather than dressing an email as a company', async () => {
    await render(<DiscoveryLedger entries={[UNRESOLVED]} />);

    await expect.element(page.getByText(/Account not resolved — dreyes@kestrelcapital\.example/)).toBeInTheDocument();
  });
});

describe('reason codes', () => {
  it('puts one code and one sentence on the row, and the long reasoning behind Evidence', async () => {
    await render(<DiscoveryLedger entries={[NOT_DISCOVERY]} />);

    await expect.element(page.getByText('Existing opportunity', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('Existing opportunity; diligence and bid preparation already underway.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('technical diligence is underway');

    await userEvent.click(page.getByTestId('ledger-details-toggle'));

    await expect.element(page.getByTestId('ledger-details')).toHaveTextContent('technical diligence is underway');
  });
});
