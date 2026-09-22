import type { LeadRow, LeadRunState } from './LeadDetail';
import type { ReviewCardRun } from '@/features/review/ReviewSurface';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { canonicalBody } from '@/features/review/contentWalk';
import { contentHash } from '@/libs/actions/contentHash';
import { computeConfidenceDimensions, researchState, SIGNAL_STATE_LABEL } from '@/services/personalization/confidence';
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
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard',
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

/**
 * The same run with both sends already approved.
 *
 * The lead page mounts the same shell, so it gets the per-send walk and its
 * hold — which is the point (both surfaces, one operation). A test that is
 * about something else therefore arrives past the walk rather than having its
 * assertion weakened around it. `LeadDetail.walk` covers the hold itself.
 */
const WALKED_RUN: ReviewCardRun = {
  ...PENDING_RUN,
  contentReview: Object.fromEntries((PENDING_RUN.card.content ?? [])
    .filter(i => i.kind === 'email')
    .map(i => [i.id, { hash: contentHash(i.kind === 'email' ? i.subject : undefined, canonicalBody(i.kind === 'email' ? i.body : '')), at: '2026-09-18T12:00:00.000Z' }])),
};

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
    // The acquisition facts are label-over-value cells on the one meta row,
    // not a middot line: the flat template reads them the same way on every
    // object type.
    await expect.element(page.getByTestId('review-meta').getByText('Became MQL')).toBeVisible();
    await expect.element(page.getByTestId('review-meta').getByText('Sep 1', { exact: true })).toBeVisible();
    // A coverage STATE, never a percentage: the five dimensions grade how much
    // of the evidence we got, which is not a calibrated probability, and
    // quoting it as one claims a precision nothing behind it earns. The
    // subject still travels with the reading (#379).
    // A coverage STATE, never a percentage, and derived from the SAME
    // dimensions the brief lists — so the headline and the per-signal rows
    // cannot tell different stories. The fixture stores `confidence: 0.6`
    // while its dimensions actually average below the established cut, and
    // the old header quoted the stored number: "Research 60%" over a brief
    // whose signals were weak. That disagreement is what the CEO could not
    // account for, and it is now unrepresentable.
    await expect.element(page.getByText(/Research\s+Weak/).first()).toBeVisible();
    expect(page.getByText('Research 60%').elements()).toHaveLength(0);

    // The permanent metadata column is gone — the timeline and the CRM
    // context moved into Evidence, not a rail beside the page.
    expect(page.getByRole('complementary').elements()).toHaveLength(0);
    expect(page.getByText('Reference articles').elements()).toHaveLength(0);
  });

  it('reads the headline off the same dimensions as the rows, so the two cannot disagree', async () => {
    const dimensions = computeConfidenceDimensions({ contactName: 'Rowan Pike', contactTitle: 'CEO', companyName: 'Tideline Gaming Marketing Inc', claims: CLAIMS });

    await render(
      <LeadDetail
        lead={lead({ id: 88213, contactName: 'Rowan Pike', confidence: 0.95, confidenceDimensions: dimensions })}
        contactHref={null}
        runState={NO_RUN}
      />,
    );

    // `confidence` says 0.95; the dimensions say otherwise. The header follows
    // the dimensions, because those are the thing the brief shows its working
    // for. A stored number nobody can trace is what "42%" was.
    const expected = SIGNAL_STATE_LABEL[researchState(dimensions)];

    await expect.element(page.getByText(new RegExp(`Research\\s+${expected}`)).first()).toBeVisible();
  });

  it('grades each signal as a state with what it rests on, and quotes no percentage', async () => {
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

    await expect.element(page.getByText('Identity', { exact: false }).first()).toBeVisible();
    // Chris, 2026-09-16: *"I would stop presenting these as percentages unless
    // you have genuinely calibrated probabilities behind them."*
    expect(page.getByText('%').elements()).toHaveLength(0);
  });

  it('collapses the brief to the five sections and states each absence ONCE', async () => {
    await render(<LeadDetail lead={lead({ id: 88201, contactName: 'Rowan Pike' })} contactHref={null} runState={NO_RUN} />);

    await expect.element(page.getByText('What we know')).toBeVisible();
    await expect.element(page.getByText('What we couldn\'t verify')).toBeVisible();
    await expect.element(page.getByText('Recommended angle')).toBeVisible();
    await expect.element(page.getByText('Sources')).toBeVisible();
    await expect.element(page.getByText('Research confidence')).toBeVisible();
    expect(page.getByText('No public team size.').elements()).toHaveLength(1);

    // CRM context is real, and it belongs to Evidence rather than the brief —
    // said once, in the dossier under the content, not repeated in the brief.
    expect(page.getByText('Enrolled in an automated nurture minutes after becoming an MQL.').elements()).toHaveLength(1);
    expect(page.getByTestId('evidence-pane').getByText('Enrolled in an automated nurture minutes after becoming an MQL.').elements()).toHaveLength(1);
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

    await expect.element(page.getByText('Engagement — Unavailable · nothing can be inferred')).toBeVisible();
  });

  it('puts the timeline, the claims and the run details under Evidence', async () => {
    await render(<LeadDetail lead={lead({ id: 88201, contactName: 'Rowan Pike' })} contactHref={null} runState={NO_RUN} />);

    // Under the content, not behind a tab: the strip is what there is to
    // review, and the evidence for it reads without a click.
    await expect.element(page.getByText('Enrolled in an automated nurture minutes after becoming an MQL.')).toBeVisible();
    await expect.element(page.getByText('Runs an iGaming marketing agency.')).toBeVisible();
    await expect.element(page.getByTestId('evidence-tab').getByText('Became MQL')).toBeVisible();
    await expect.element(page.getByText('Brief version')).toBeVisible();
  });
});

describe('the per-send walk, on the lead page too', () => {
  it('shows the same checks and the same count the queue does', async () => {
    // The lead page mounts the SAME shell, so the walk arrives here without
    // the page knowing about it — which is the whole point of one template.
    const half = {
      ...PENDING_RUN,
      contentReview: { 'send-1': { hash: contentHash('The ebook you pulled', canonicalBody('One line on the ebook.')), at: '2026-09-18T12:00:00.000Z' } },
    } as ReviewCardRun;
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: half }}
      />,
    );

    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('1 of 2 approved');
    await expect.element(page.getByTestId('tab-check-send-1')).toBeVisible();
  });

  it('reads Approve here until the count is full, for the same reason', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
      />,
    );

    const primary = page.getByTestId('decide-approve').element();

    // One primary, and it is the walk: live, reading Approve, with the count
    // over the tab row saying how far along it is.
    expect(primary).not.toBeDisabled();
    expect(primary.querySelector('span')?.textContent?.trim()).toBe('Approve');
    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('0 of 2 approved');
    expect(page.getByTestId('primary-held').elements()).toHaveLength(0);
  });

  it('becomes Enroll here once every send carries a check', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: WALKED_RUN }}
      />,
    );

    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('2 of 2 approved');
    await expect.element(page.getByTestId('decide-approve')).toBeEnabled();
    expect(page.getByTestId('decide-approve').element().querySelector('span')?.textContent?.trim()).toBe('Enroll');
  });
});

describe('the sequence state, resolved before an Enroll button', () => {
  it('states the transaction — unenroll from the automated nurture, enroll in the recommendation', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: WALKED_RUN }}
      />,
    );

    // The screen states what the CRM last observed, and then stops. It no
    // longer spells out what approving will do (settled 2026-09-17): the
    // sentence was removed and the held primary carries the reason instead,
    // so a determinable transaction simply leaves Enroll live.
    await expect.element(page.getByTestId('sequence-state-current')).toHaveTextContent('MQL Auto-Nurture');
    await expect.element(page.getByTestId('decide-approve')).toBeEnabled();
    expect(page.getByTestId('primary-held').elements()).toHaveLength(0);
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

    await expect.element(page.getByTestId('primary-held')).toHaveTextContent(/replaces it or runs alongside it/);

    const approve = page.getByTestId('decide-approve').element();

    expect(approve).toBeDisabled();
    // The reason is reachable FROM the button, not only from the notice: a
    // disabled control takes no pointer events, so the tooltip rides a
    // wrapper and the same text is its accessible description.
    expect(approve.closest('[title]')?.getAttribute('title')).toMatch(/replaces it or runs alongside it/);
    expect(document.getElementById(approve.getAttribute('aria-describedby')!)?.textContent).toMatch(/replaces it or runs alongside it/);
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

/** The lead's three artifacts, as the page receives them (0112). */
const ARTIFACTS = [
  { role: 'brief' as const, id: 9001, title: 'Rowan Pike — research brief', version: 2, kind: 'markdown', ref: { type: 'artifact' as const, id: '9001' } },
  { role: 'recommendation' as const, id: 9002, title: 'Rowan Pike — outreach recommendation', version: 1, kind: 'markdown', ref: { type: 'artifact' as const, id: '9002' } },
  { role: 'sequence' as const, id: 9003, title: 'Rowan Pike — draft sequence', version: 1, kind: 'sequence', ref: { type: 'artifact' as const, id: '9003' } },
];

describe('reading one artifact while editing another', () => {
  /**
   * Chris, 2026-09-17: *"wanting to see the brief or evidence in sidebar
   * preview, while i edit the sequence content."* Tabs cannot do this — they
   * are mutually exclusive — so the side panel does.
   */
  it('offers the brief and the recommendation beside the sequence, but never the sequence itself', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88220,
          contactName: 'Rowan Pike',
          recommendedSequence: NURTURE,
          draftSequence: [{ step: 1, day: 0, subject: 'The ebook you pulled', body: 'One line.' }],
        })}
        artifacts={ARTIFACTS}
        contactHref={HUBSPOT}
        runState={NO_RUN}
      />,
    );

    await expect.element(page.getByTestId('reference-brief')).toBeVisible();
    await expect.element(page.getByTestId('reference-recommendation')).toBeVisible();
    // Previewing the thing you are already looking at is the "two copies of
    // the same page" failure the rail rules ban.
    expect(page.getByTestId('reference-sequence').elements()).toHaveLength(0);
  });

  it('keeps you on the sequence when you send the brief to the panel', async () => {
    await render(
      <LeadDetail
        lead={lead({
          id: 88221,
          contactName: 'Rowan Pike',
          recommendedSequence: NURTURE,
          draftSequence: [{ step: 1, day: 0, subject: 'The ebook you pulled', body: 'One line.' }],
        })}
        artifacts={ARTIFACTS}
        contactHref={HUBSPOT}
        runState={NO_RUN}
      />,
    );

    await page.getByTestId('reference-brief').click();

    // Still the sequence — the point of the control is that you do not lose
    // the send you were halfway through writing.
    expect(page.getByTestId('brief-tab').elements()).toHaveLength(0);
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

    await expect.element(page.getByTestId('review-tabs')).toBeVisible();
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

    const labels = await page.getByTestId('review-tabs').element().textContent;

    expect(labels?.indexOf('Sequence')).toBeLessThan(labels?.indexOf('Brief') ?? -1);
  });
});

describe('the sequence tab', () => {
  it('decides the SAME run the review queue does, with the same verbs', async () => {
    // Walked, so the primary is the card's own verb rather than the walk's
    // Approve — this is about the verbs the lead page decides WITH.
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: WALKED_RUN }}
      />,
    );

    await expect.element(page.getByRole('button', { name: 'Enroll' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Decline' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Snooze' })).toBeVisible();
    // Feedback is optional on every verb: a fast no must not cost a note.
    await expect.element(page.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('IS the review surface — one rendering path, not a second layout that agrees with it', async () => {
    await render(
      <LeadDetail
        lead={lead({ id: 88201, contactName: 'Rowan Pike', reviewActionRunId: 501, recommendedSequence: NURTURE, currentSequence: REPLACE })}
        contactHref={HUBSPOT}
        runState={{ ...NO_RUN, run: PENDING_RUN }}
      />,
    );

    // The shell's own parts, drawn by the shell: the hairline meta row, the
    // tab strip, the sticky bar. A page that merely looked the same would
    // carry none of them.
    await expect.element(page.getByTestId('review-meta')).toBeVisible();
    await expect.element(page.getByTestId('review-tabs')).toBeVisible();
    await expect.element(page.getByTestId('sticky-action-bar')).toBeVisible();

    // And the zones no object type can drop, built from the run rather than
    // from anything the lead page passes. Off the strip now, still on the
    // page: the strip is what there is to review.
    const labels = [...page.getByTestId('review-tabs').element().querySelectorAll('[data-slot="tabs-trigger"]')].map(t => t.textContent);

    expect(labels).not.toContain('Why');
    expect(labels).not.toContain('Evidence');
    await expect.element(page.getByTestId('why-pane')).toBeVisible();
    await expect.element(page.getByTestId('evidence-pane')).toBeVisible();
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

    // Each send is its own tab now, and the first one opens.
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

    // The control sits beside the send it scopes to, in that send's own tab.
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
