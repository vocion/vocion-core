import type { LeadRow, LeadRunState } from './LeadDetail';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { publishDraftRevision } from './draftRevision';
import { LeadDetail } from './LeadDetail';

// The regenerate control and the decide path refresh the route after a write.
// There is no router outside the app shell, so the hook is stubbed.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

// The back link renders through the locale-aware Link; the tests only need an
// anchor with the right href.
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

/**
 * The lead page is the lead's record: identity and provenance up top, the
 * decision (or what was decided) leading the main column, the brief and the
 * evidence rail below. These cover both page states and the failure states
 * the queue used to carry inline.
 */

const SECTIONS = [
  { heading: 'Prospect', body: 'Rowan Pike, CEO at Tideline Gaming Marketing Inc.' },
  { heading: 'Recommended Angle', body: 'Ask about the affiliate compliance workload.' },
];

const NO_RUN: LeadRunState = { run: null, snoozedUntil: null, runFailed: false };

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
    recommendation: { headline: 'Enroll in: LinkedIn Ebook Inbound Sequence · 2 sends' },
    content: [
      { kind: 'email', id: 'send-1', label: 'Day 0', subject: 'The ebook you pulled', body: 'Pete, following up on the ebook.' },
      { kind: 'email', id: 'send-2', label: 'Day 4', subject: 'One level deeper', body: 'The section most teams skip.' },
    ],
    fields: [],
    verbs: { approve: 'Enroll', reject: 'Decline' },
  },
};

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
    sections: SECTIONS,
    claims: [
      { text: 'Runs an iGaming marketing agency.', kind: 'Fact', source: 'https://tideline.example/about', date: '2026-08-30' },
      { text: 'Compliance is the likely pain point.', kind: 'Inference', source: 'https://tideline.example/about' },
    ],
    missing: ['No public team size.'],
    briefError: null,
    briefAttempts: 1,
    regenerateNote: null,
    draftSequence: [],
    recommendedSequence: null,
    reviewActionRunId: null,
    draftError: null,
    mqlAt: '2026-09-01T12:00:00.000Z',
    arrivedAt: '2026-08-29T09:00:00.000Z',
    briefedAt: '2026-09-01T14:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    handoffSections: [],
    handoffTrigger: null,
    handoffAt: null,
    ...over,
  };
}

const HUBSPOT = 'https://app.hubspot.com/contacts/12345/record/0-1/88201';

describe('LeadDetail', () => {
  it('renders the full record: identity, chips, brief, reference articles, claims, missing, confidence, timeline', async () => {
    await render(<LeadDetail lead={lead({ id: 88201, contactName: 'Rowan Pike' })} contactHref={HUBSPOT} runState={NO_RUN} />);

    // Header: who, where they work, the CRM door, provenance chips, the lane.
    await expect.element(page.getByRole('heading', { name: 'Rowan Pike' })).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Open in HubSpot ↗' })).toBeVisible();
    await expect.element(page.getByText('Paid social')).toBeVisible();
    await expect.element(page.getByText('MQL Sep 1')).toBeVisible();
    // One confidence renderer everywhere now, and never a bare score: the
    // subject the number is about travels with it (`ConfidenceBars`).
    await expect.element(page.getByText('Brief 60%').first()).toBeVisible();

    // The brief, at readable width, with its Regenerate control.
    await expect.element(page.getByText('Rowan Pike, CEO at Tideline Gaming Marketing Inc.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Regenerate' })).toBeVisible();

    // The rail: what the research read, claimed, could not reach, and scored.
    await expect.element(page.getByText('Reference articles')).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'tideline.example/about ↗' })).toBeVisible();
    await expect.element(page.getByText('Runs an iGaming marketing agency.')).toBeVisible();
    await expect.element(page.getByText('No public team size.')).toBeVisible();
    await expect.element(page.getByText('Brief 60%').nth(1)).toBeVisible();

    // The timeline, oldest first, decided absent because nothing was decided.
    await expect.element(page.getByText('Arrived')).toBeVisible();
    await expect.element(page.getByText('Became MQL')).toBeVisible();
    await expect.element(page.getByText('Briefed')).toBeVisible();
    expect(page.getByText('Decided').elements()).toHaveLength(0);

    // The back door to the queue.
    await expect.element(page.getByRole('link', { name: 'Personalization' })).toBeVisible();
  });

  it('renders the handoff brief beneath the review brief, headed by trigger and time, with nothing to decide', async () => {
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

    const zone = page.getByRole('region', { name: 'Handoff brief' });

    await expect.element(zone).toBeVisible();
    await expect.element(zone.getByText('Handoff brief · Replied · Sep 9')).toBeVisible();
    await expect.element(zone.getByText('Two sends, one reply on Day 4.')).toBeVisible();
    await expect.element(zone.getByText('Affiliate compliance is manual today. Medium.')).toBeVisible();
    // The review brief is still above it, and no decision surface appears.
    await expect.element(page.getByText('Rowan Pike, CEO at Tideline Gaming Marketing Inc.')).toBeVisible();
    expect(page.getByRole('button', { name: 'Enroll' }).elements()).toHaveLength(0);
  });

  it('shows no handoff zone until a handoff brief exists', async () => {
    await render(<LeadDetail lead={lead({ id: 88201, contactName: 'Rowan Pike' })} contactHref={null} runState={NO_RUN} />);

    expect(page.getByRole('region', { name: 'Handoff brief' }).elements()).toHaveLength(0);
  });

  it('lists each reference article once, however many claims cite it', async () => {
    await render(<LeadDetail lead={lead({ id: 88201, contactName: 'Rowan Pike' })} contactHref={null} runState={NO_RUN} />);

    expect(page.getByRole('link', { name: 'tideline.example/about ↗' }).elements()).toHaveLength(1);
  });

  it('renders the shared review card when the lead has a pending enroll run — same run, same verbs', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501 })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
      />,
    );

    await expect.element(page.getByTestId('review-action-card')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Enroll' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Decline' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Snooze' })).toBeVisible();
    // Feedback is optional on every verb: a fast no must not cost a note.
    await expect.element(page.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('a rewrite asked for in the conversation lands HERE, marked edited — the rail reports it, the record shows it', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501 })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
        guided
      />,
    );

    await expect.element(page.getByText('Pete, following up on the ebook.')).toBeVisible();

    publishDraftRevision({ runId: 501, contentId: 'send-1', body: 'Pete — one line on the ebook.' });

    await expect.element(page.getByText('Pete — one line on the ebook.')).toBeVisible();
    // The page says which send changed, the way an edit made here would.
    await expect.element(page.getByText('edited')).toBeVisible();
  });

  it('ignores a rewrite announced for a different run', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501 })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
        guided
      />,
    );

    await expect.element(page.getByText('Pete, following up on the ebook.')).toBeVisible();

    publishDraftRevision({ runId: 999, contentId: 'send-1', body: 'not this lead' });

    expect(page.getByText('not this lead').elements()).toHaveLength(0);
  });

  it('shows the decision record for a handed-off lead: the line, the read-only sends, no card', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88201,
          contactName: 'Rowan Pike',
          status: 'handed_off',
          reviewActionRunId: 999,
          recommendedSequence: { id: 'seq-1', name: 'LinkedIn Ebook Inbound Sequence' },
          draftSequence: [{ step: 1, day: 0, subject: 'The ebook you pulled', body: 'Pete, following up on the ebook.' }],
          decidedAt: '2026-09-01T16:00:00.000Z',
          decidedBy: 'jamie@metacto.com',
        })}
        contactHref={HUBSPOT}
        runState={NO_RUN}
      />,
    );

    await expect.element(page.getByText('Enrolled in LinkedIn Ebook Inbound Sequence by jamie@metacto.com · Sep 1, 2026')).toBeVisible();
    await expect.element(page.getByText(/Day 0 · The ebook you pulled/)).toBeVisible();
    expect(page.getByTestId('review-action-card').elements()).toHaveLength(0);
  });

  it('shows a held lead as held, with who declined it', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88201,
          contactName: 'Rowan Pike',
          status: 'held',
          decidedAt: '2026-09-01T16:00:00.000Z',
          decidedBy: 'jamie@metacto.com',
        })}
        contactHref={null}
        runState={NO_RUN}
      />,
    );

    await expect.element(page.getByText(/Held by jamie@metacto\.com · Sep 1, 2026/)).toBeVisible();
    expect(page.getByTestId('review-action-card').elements()).toHaveLength(0);
  });

  it('shows a snoozed run as snoozed, with the date the card returns', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88201,
          contactName: 'Rowan Pike',
          reviewActionRunId: 777,
          draftSequence: [{ step: 1, subject: 'The ebook you pulled', body: 'Pete, following up.' }],
        })}
        contactHref={null}
        runState={{ ...NO_RUN, snoozedUntil: '2026-09-08T09:00:00.000Z' }}
      />,
    );

    await expect.element(page.getByText('Snoozed · the card returns Sep 8, 2026')).toBeVisible();
    expect(page.getByTestId('review-action-card').elements()).toHaveLength(0);
  });

  it('names a failed enrollment rather than reading it as still waiting', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88201,
          contactName: 'Rowan Pike',
          reviewActionRunId: 777,
          draftSequence: [{ step: 1, subject: 'The ebook you pulled', body: 'Pete, following up.' }],
        })}
        contactHref={null}
        runState={{ ...NO_RUN, runFailed: true }}
      />,
    );

    await expect.element(page.getByText(/The approved enrollment failed to execute/)).toBeVisible();
    expect(page.getByTestId('review-action-card').elements()).toHaveLength(0);
  });

  it('renders the briefing failure where the brief would be, with Regenerate available', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88202,
          contactName: 'Dee Nakamura',
          sections: [],
          claims: [],
          missing: [],
          confidence: null,
          briefAttempts: 3,
          briefError: 'web_search returned "search provider unconfigured" on every query.',
        })}
        contactHref={null}
        runState={NO_RUN}
      />,
    );

    await expect.element(page.getByText('No brief. Briefing failed 3 times')).toBeVisible();
    await expect.element(page.getByText('web_search returned "search provider unconfigured" on every query.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Regenerate' })).toBeVisible();
  });

  it('renders the drafting failure in the outreach zone', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88203,
          contactName: 'Rosa Lindqvist',
          draftError: 'The sequence library returned no match for the recommended id.',
        })}
        contactHref={null}
        runState={NO_RUN}
      />,
    );

    await expect.element(page.getByText(/Drafting has not produced sends yet/)).toBeVisible();
    await expect.element(page.getByText(/The sequence library returned no match/)).toBeVisible();
  });
});
