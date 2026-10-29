/**
 * What the screen says about the agent's recommendation.
 *
 * The advice alone asks a reviewer to take the agent's word for it; the reason
 * behind it is the part they can check. Both render from the RUN rather than
 * from the presenter, so no object type can drop them — and they now live in
 * the zones the shell composes: the advice under Evidence with the rest of the
 * run's facts, the reason under Why, in full.
 *
 * Also pinned here: the two shapes that must render nothing — a run proposed
 * before the reason existed, and a reason that somehow arrived with no
 * recommendation to explain.
 */
import type { ReviewCardRun } from './ReviewSurface';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: { review: { decideAction: vi.fn(), snoozeAction: vi.fn(), regenerateAction: vi.fn(), actionStatus: vi.fn() } },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/inbox',
}));

const { ReviewSurface } = await import('./ReviewSurface');

const CRUMBS = [{ label: 'Workspace' }, { label: 'Review queue' }, { label: 'Recommendations' }];
const REASON = 'Third listing of this same show this week.';

/**
 * One pending candidate, with whatever the agent advised attached.
 * @param proposal - The proposal envelope under test.
 */
function runWith(proposal: ReviewCardRun['proposal']): ReviewCardRun {
  return {
    id: 41,
    actionId: 'objects.propose_candidate',
    status: 'pending',
    invokedBy: 'agent:listing-scout',
    proposal,
    input: {},
    card: {
      title: 'Open Mic Night',
      system: 'Events',
      subject: { name: 'The Corvina' },
      provenance: [{ label: 'Source', value: 'bellwaterhall.example' }],
      content: [],
      fields: [],
      links: [],
      verbs: { approve: 'Approve', reject: 'Reject' },
    },
  };
}

/** Unfold the Why, evidence and run details. */
async function openDossier() {
  await page.getByText('Why, evidence and run details').click();
}

describe('the agent recommendation on the review surface', () => {
  it('says the advice, and the fact that tipped it, on the decision line', async () => {
    await render(<ReviewSurface run={runWith({ confidence: 0.9, suggestedDecision: 'reject', suggestedDecisionReason: REASON })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('review-decision-line')).toHaveTextContent('listing-scout suggests turning it down. Third listing of this same show this week · 90% confident');

    await openDossier();

    await expect.element(page.getByTestId('run-details')).toHaveTextContent('Turning down');
    expect(page.getByTestId('run-details').element().textContent).not.toMatch(/Agent suggests/);
  });

  it('gives the reason in full under Why', async () => {
    // Nothing caps the stored reason, and a model that writes two sentences
    // where one was asked for must not be cut mid-word.
    const long = `The venue sits outside the coverage area, ${'and the run repeats every Tuesday, '.repeat(9)}so a person should turn it down.`;

    await render(<ReviewSurface run={runWith({ confidence: 0.4, suggestedDecision: 'reject', suggestedDecisionReason: long })} crumbs={CRUMBS} />);

    await openDossier();

    await expect.element(page.getByTestId('why-merged')).toHaveTextContent(long);
  });

  it('keeps the reason and the rationale as two labelled lines, word for word', async () => {
    const rationale = `The listing carries a date, a venue and a price. ${REASON}`;
    await render(
      <ReviewSurface
        run={runWith({ confidence: 0.9, rationale, suggestedDecision: 'reject', suggestedDecisionReason: REASON })}
        crumbs={CRUMBS}
      />,
    );

    await openDossier();

    await expect.element(page.getByTestId('why-rationale')).toHaveTextContent(rationale);
    await expect.element(page.getByTestId('suggested-decision-reason')).toHaveTextContent(`Why it suggests turning down${REASON}`);
  });

  it('shows the advice alone for a run proposed before reasons existed', async () => {
    await render(<ReviewSurface run={runWith({ confidence: 0.9, suggestedDecision: 'approve' })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('review-decision-line')).toHaveTextContent('listing-scout suggests approving · 90% confident');
    expect(page.getByTestId('why-merged').elements()).toHaveLength(0);
  });

  it('renders no reason when nothing was recommended', async () => {
    // `proposeAction` drops an orphan reason before it is ever stored, so this
    // is the view holding the same line: a sentence arguing for an outcome,
    // with no outcome named, tells a reviewer nothing they can act on.
    await render(<ReviewSurface run={runWith({ confidence: 0.9, suggestedDecisionReason: REASON })} crumbs={CRUMBS} />);

    expect(page.getByText(REASON).elements()).toHaveLength(0);
  });
});
