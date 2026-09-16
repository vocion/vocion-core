import type { LeadRow, LeadRunState } from './LeadDetail';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { computeConfidenceDimensions } from '@/services/personalization/confidence';
import { publishDraftRevision } from './draftRevision';
import { LeadDetail } from './LeadDetail';

// The regenerate control and the decide path refresh the route after a write.
// There is no router outside the app shell, so the hooks are stubbed.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

// The back link renders through the locale-aware Link; the tests only need an
// anchor with the right href.
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

/**
 * The lead workspace: header, ONE recommendation block with the sequence-state
 * reconciliation in it, then Brief · Sequence · Evidence. Rebuilt to
 * `docs/specs/personalization-v2.md`; these cover the review's two P0s, the
 * reduction, and the states the page has always had to carry.
 */

const SECTIONS = [
  { heading: 'Prospect', body: 'Rowan Pike, CEO at Tideline Gaming Marketing Inc.' },
  { heading: 'Recommended Angle', body: 'Ask about the affiliate compliance workload.' },
  { heading: 'CRM Context', body: 'Enrolled in an automated nurture minutes after becoming an MQL.' },
];

const NO_RUN: LeadRunState = { run: null, snoozedUntil: null, runFailed: false, pinned: [] };

/** The pending enroll run the review queue would show — the SAME run object. */
const PENDING_RUN: ReviewCardRun = {
  id: 501,
  actionId: 'personalization.enroll',
  status: 'pending',
  input: {},
  invokedBy: 'agent:revenue-lead',
  proposal: { confidence: 0.84 },
  card: {
    title: 'New MQL ready to enroll',
    system: 'Personalization',
    subject: { name: 'Rowan Pike', role: 'CEO', company: 'Tideline Gaming Marketing Inc' },
    recommendation: { headline: 'Enroll in Ebook Inbound Sequence · 2 sends' },
    content: [
      { kind: 'email', id: 'send-1', label: 'Send 1', subject: 'The ebook you pulled', body: 'One line on the ebook.' },
      { kind: 'email', id: 'send-2', label: 'Send 2', subject: 'One level deeper', body: 'The section most teams skip.' },
    ],
    fields: [],
    verbs: { approve: 'Enroll', reject: 'Decline' },
  },
} as ReviewCardRun;

const CLAIMS = [
  { text: 'Runs an iGaming marketing agency.', kind: 'Fact', source: 'https://tideline.example/about', date: '2026-08-30' },
  { text: 'Compliance is the likely pain point.', kind: 'Inference', source: 'https://tideline.example/about' },
];

function lead(over: Partial<LeadRow> & Pick<LeadRow, 'id' | 'contactName'>): LeadRow {
  return {
    contactRef: `contacts:${over.id}`,
    contactTitle: 'CEO',
    companyName: 'Tideline Gaming Marketing Inc',
    entranceSource: 'PAID_SOCIAL',
    utmCampaign: 'LinkedIn',
    engagementSent: 2,
    engagementOpened: 1,
    status: 'ready_for_review',
    confidence: 0.6,
    confidenceDimensions: computeConfidenceDimensions({
      contactName: over.contactName,
      contactTitle: 'CEO',
      companyName: 'Tideline Gaming Marketing Inc',
      entranceSource: 'PAID_SOCIAL',
      utmCampaign: 'LinkedIn',
      mqlAt: '2026-09-01T12:00:00.000Z',
      claims: CLAIMS,
    }),
    sections: SECTIONS,
    claims: CLAIMS,
    missing: ['No public team size.'],
    briefError: null,
    briefAttempts: 1,
    regenerateNote: null,
    draftSequence: [],
    recommendedSequence: null,
    currentSequence: null,
    reviewActionRunId: null,
    draftError: null,
    mqlAt: '2026-09-01T12:00:00.000Z',
    arrivedAt: '2026-08-29T09:00:00.000Z',
    briefedAt: '2026-09-01T14:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    briefVersion: 'model#personalization-v1',
    workspaceSha: 'a1b2c3d',
    handoffSections: [],
    handoffTrigger: null,
    handoffAt: null,
    ...over,
  };
}

const HUBSPOT = 'https://app.hubspot.com/contacts/12345/record/0-1/88201';
const REPLACE = { id: 'seq-auto', name: 'MQL Auto-Nurture', status: 'active', kind: 'automated', step: 1, totalSteps: 3 };
const NURTURE = { id: 'seq-311', name: 'Ebook Inbound Sequence' };

describe('the lead workspace — three zones, three tabs', () => {
  it('leads with identity, acquisition and one research-confidence reading, and draws NO metadata column', async () => {
    await render(<LeadDetail lead={lead({ id: 88201, contactName: 'Rowan Pike' })} contactHref={HUBSPOT} runState={NO_RUN} />);

    await expect.element(page.getByRole('heading', { name: 'Rowan Pike' })).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Open in HubSpot ↗' })).toBeVisible();
    await expect.element(page.getByText('Paid social')).toBeVisible();
    await expect.element(page.getByText('MQL Sep 1')).toBeVisible();
    // Never a bare score: the subject travels with the number (#379).
    await expect.element(page.getByText('Research 60%').first()).toBeVisible();

    // The permanent metadata column is gone — the timeline and the CRM
    // context moved into Evidence, not a rail beside the page.
    expect(page.getByRole('complementary').elements()).toHaveLength(0);
    expect(page.getByText('Reference articles').elements()).toHaveLength(0);
  });

  it('collapses the brief to the five sections and states each absence ONCE', async () => {
    await render(<LeadDetail lead={lead({ id: 88201, contactName: 'Rowan Pike' })} contactHref={null} runState={NO_RUN} />);

    await expect.element(page.getByText('What we know')).toBeVisible();
    await expect.element(page.getByText('What we couldn\'t verify')).toBeVisible();
    await expect.element(page.getByText('Recommended angle')).toBeVisible();
    await expect.element(page.getByText('Sources')).toBeVisible();
    await expect.element(page.getByText('Research confidence')).toBeVisible();
    expect(page.getByText('No public team size.').elements()).toHaveLength(1);

    // CRM context is real, and it is under Evidence rather than in the brief.
    expect(page.getByText('Enrolled in an automated nurture minutes after becoming an MQL.').elements()).toHaveLength(0);
  });

  it('shows engagement as UNAVAILABLE rather than as a low score', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88201,
          contactName: 'Rowan Pike',
          confidenceDimensions: computeConfidenceDimensions({ contactName: 'Rowan Pike', contactTitle: 'CEO', companyName: 'Tideline Gaming Marketing Inc', claims: CLAIMS }),
        })}
        contactHref={null}
        runState={NO_RUN}
      />,
    );

    await expect.element(page.getByText('Engagement unavailable — nothing can be inferred')).toBeVisible();
  });

  it('puts the timeline, the claims and the run details under Evidence', async () => {
    await render(<LeadDetail lead={lead({ id: 88201, contactName: 'Rowan Pike' })} contactHref={null} runState={NO_RUN} />);

    await page.getByRole('tab', { name: 'Evidence' }).click();

    await expect.element(page.getByText('Enrolled in an automated nurture minutes after becoming an MQL.')).toBeVisible();
    await expect.element(page.getByText('Runs an iGaming marketing agency.')).toBeVisible();
    await expect.element(page.getByText('Became MQL')).toBeVisible();
    await expect.element(page.getByText('Brief version')).toBeVisible();
  });
});

describe('the sequence state, resolved before an Enroll button', () => {
  it('states the transaction — unenroll from the automated nurture, enroll in the recommendation', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
      />,
    );

    await expect.element(page.getByTestId('sequence-state-current')).toBeVisible();
    await expect.element(page.getByTestId('sequence-state-transaction')).toHaveTextContent('Unenroll from MQL Auto-Nurture and enroll in Ebook Inbound Sequence.');
    await expect.element(page.getByTestId('decide-approve')).toBeEnabled();
  });

  it('holds Enroll, and says why, when the data cannot say whether it adds or replaces', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88201,
          contactName: 'Rowan Pike',
          reviewActionRunId: 501,
          recommendedSequence: NURTURE,
          currentSequence: { name: 'Inbound Follow-up', status: 'active', kind: 'manual' },
        })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
      />,
    );

    await expect.element(page.getByTestId('sequence-state-held')).toBeVisible();
    await expect.element(page.getByTestId('sequence-state-held')).toHaveTextContent(/replaces it or runs alongside it/);
    await expect.element(page.getByTestId('decide-approve')).toBeDisabled();
    expect(page.getByTestId('sequence-state-transaction').elements()).toHaveLength(0);
  });

  it('holds Enroll when the CRM never said whether the contact is in a sequence at all', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: null })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
      />,
    );

    await expect.element(page.getByTestId('sequence-state-current')).toHaveTextContent(/Not established/);
    await expect.element(page.getByTestId('decide-approve')).toBeDisabled();
  });
});

describe('which tab the page opens on', () => {
  /**
   * The page is an enrollment review, so the sends are the work being
   * approved and the brief is the justification. Chris, 2026-09-16: *"the
   * sequence is the thing the human is actually approving. The brief and
   * evidence exist to justify it."*
   */
  it('opens on the sequence when there are sends waiting to be approved', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88210,
          contactName: 'Rowan Pike',
          recommendedSequence: NURTURE,
          currentSequence: REPLACE,
          draftSequence: [{ step: 1, day: 0, subject: 'The ebook you pulled', body: 'One line.' }],
        })}
        contactHref={HUBSPOT}
        runState={NO_RUN}
      />,
    );

    await expect.element(page.getByTestId('lead-tabs')).toBeVisible();
    expect(page.getByTestId('brief-tab').elements()).toHaveLength(0);
  });

  it('falls back to the brief when there is nothing to send yet', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88211, contactName: 'Rowan Pike', draftSequence: [] })}
        contactHref={HUBSPOT}
        runState={NO_RUN}
      />,
    );

    await expect.element(page.getByTestId('brief-tab')).toBeVisible();
  });

  it('puts the sequence first in the tab order, before the brief', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88212,
          contactName: 'Rowan Pike',
          recommendedSequence: NURTURE,
          draftSequence: [{ step: 1, day: 0, subject: 'The ebook you pulled', body: 'One line.' }],
        })}
        contactHref={HUBSPOT}
        runState={NO_RUN}
      />,
    );

    const labels = await page.getByTestId('lead-tabs').element().textContent;

    expect(labels?.indexOf('Sequence')).toBeLessThan(labels?.indexOf('Brief') ?? -1);
  });
});

describe('the sequence tab', () => {
  it('decides the SAME run the review queue does, with the same verbs', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
      />,
    );

    await expect.element(page.getByRole('button', { name: 'Enroll' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Decline' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Snooze' })).toBeVisible();
    // Feedback is optional on every verb: a fast no must not cost a note.
    await expect.element(page.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('a rewrite asked for in the conversation lands HERE, marked edited — the rail reports it, the record shows it', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
        guided
      />,
    );

    await page.getByRole('tab', { name: /Sequence/ }).click();

    await expect.element(page.getByText('One line on the ebook.')).toBeVisible();

    publishDraftRevision({ runId: 501, contentId: 'send-1', body: 'A shorter line on the ebook.' });

    await expect.element(page.getByText('A shorter line on the ebook.')).toBeVisible();
    await expect.element(page.getByText('edited')).toBeVisible();
  });

  it('ignores a rewrite announced for a different run', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
        guided
      />,
    );

    await page.getByRole('tab', { name: /Sequence/ }).click();
    publishDraftRevision({ runId: 999, contentId: 'send-1', body: 'not this lead' });

    expect(page.getByText('not this lead').elements()).toHaveLength(0);
  });

  it('scopes the drawer to the send being edited, so "make this less salesy" has a referent', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
        guided
      />,
    );

    await page.getByRole('tab', { name: /Sequence/ }).click();

    await expect.element(page.getByRole('button', { name: 'Editing Send 1' })).toBeVisible();
  });

  it('carries a whole-sequence Regenerate, which the surface never had', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', recommendedSequence: NURTURE, currentSequence: REPLACE, draftSequence: [{ step: 1, day: 0, subject: 'The ebook you pulled', body: 'One line.' }] })}
        contactHref={null}
        runState={NO_RUN}
      />,
    );

    await page.getByRole('tab', { name: /Sequence/ }).click();

    await expect.element(page.getByTestId('regenerate-sequence')).toBeVisible();
  });

  it('renders the drafting failure where the sends would be', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88203, contactName: 'Rosa Lindqvist', draftError: 'The sequence library returned no match for the recommended id.' })}
        contactHref={null}
        runState={NO_RUN}
      />,
    );

    await page.getByRole('tab', { name: /Sequence/ }).click();

    await expect.element(page.getByText(/Drafting has not produced sends yet/)).toBeVisible();
  });

  it('renders the handoff brief beneath the sequence, headed by trigger and time, with nothing to decide', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88201,
          contactName: 'Rowan Pike',
          status: 'handed_off',
          handoffSections: [
            { heading: 'Where the thread stands', body: 'Two sends, one reply on Day 4.' },
            { heading: 'Hypotheses to test', body: '- Affiliate compliance is manual today. Medium.' },
          ],
          handoffTrigger: 'reply',
          handoffAt: '2026-09-09T15:30:00.000Z',
        })}
        contactHref={null}
        runState={NO_RUN}
      />,
    );

    await page.getByRole('tab', { name: /Sequence/ }).click();
    const zone = page.getByRole('region', { name: 'Handoff brief' });

    await expect.element(zone).toBeVisible();
    await expect.element(zone.getByText('Handoff brief · Replied · Sep 9, 2026')).toBeVisible();
    expect(page.getByRole('button', { name: 'Enroll' }).elements()).toHaveLength(0);
  });
});

describe('what happened, when nothing is waiting', () => {
  it('shows the decision, who took it, and the versions it pinned', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88201,
          contactName: 'Rowan Pike',
          status: 'handed_off',
          reviewActionRunId: 999,
          recommendedSequence: NURTURE,
          currentSequence: REPLACE,
          draftSequence: [{ step: 1, day: 0, subject: 'The ebook you pulled', body: 'One line on the ebook.' }],
          decidedAt: '2026-09-01T16:00:00.000Z',
          decidedBy: 'reviewer@example.com',
        })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, pinned: [{ artifactId: 11, role: 'brief', version: 3, title: 'brief' }] }}
      />,
    );

    await expect.element(page.getByTestId('decision-line')).toHaveTextContent('Enrolled in Ebook Inbound Sequence by reviewer@example.com · Sep 1, 2026');

    await page.getByRole('tab', { name: 'Evidence' }).click();

    await expect.element(page.getByText('Approved · brief')).toBeVisible();
    await expect.element(page.getByText('#11 · v3')).toBeVisible();
  });

  it('shows a held lead as held, with who declined it', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', status: 'held', decidedAt: '2026-09-01T16:00:00.000Z', decidedBy: 'reviewer@example.com' })}
        contactHref={null}
        runState={NO_RUN}
      />,
    );

    await expect.element(page.getByTestId('decision-line')).toHaveTextContent(/Held by reviewer@example\.com · Sep 1, 2026/);
  });

  it('shows a snoozed run as snoozed, with the date the card returns', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 777 })}
        contactHref={null}
        runState={{ ...NO_RUN, snoozedUntil: '2026-09-08T09:00:00.000Z' }}
      />,
    );

    await expect.element(page.getByTestId('decision-line')).toHaveTextContent('Snoozed · the card returns Sep 8, 2026');
  });

  it('names a failed enrollment rather than reading it as still waiting', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 777 })}
        contactHref={null}
        runState={{ ...NO_RUN, runFailed: true }}
      />,
    );

    await expect.element(page.getByTestId('decision-line')).toHaveTextContent(/The approved enrollment failed to execute/);
  });

  it('renders the briefing failure where the brief would be, with a brief Regenerate at hand', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88202,
          contactName: 'Dee Nakamura',
          sections: [],
          claims: [],
          missing: [],
          confidence: null,
          confidenceDimensions: null,
          briefAttempts: 3,
          briefError: 'web_search returned "search provider unconfigured" on every query.',
        })}
        contactHref={null}
        runState={NO_RUN}
      />,
    );

    await expect.element(page.getByText('No brief. Briefing failed 3 times')).toBeVisible();
    await expect.element(page.getByTestId('regenerate-brief')).toBeVisible();
  });
});
