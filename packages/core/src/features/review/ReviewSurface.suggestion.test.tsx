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

describe('the agent recommendation on the review surface', () => {
  it('puts the advice with the rest of the run\'s facts, under Evidence', async () => {
    await render(<ReviewSurface run={runWith({ confidence: 0.9, suggestedDecision: 'reject', suggestedDecisionReason: REASON })} crumbs={CRUMBS} />);

    // Evidence is on the page now rather than behind a tab, so the advice is
    // read without a click.
    await expect.element(page.getByTestId('run-details')).toHaveTextContent('Agent suggests turning down');
  });

  it('gives the reason its own zone under Why, in full', async () => {
    // Nothing caps the stored reason, and a model that writes two sentences
    // where one was asked for must not be cut mid-word. The reason now has a
    // pane rather than a row, so the whole sentence reads.
    const long = `The venue sits outside the coverage area, ${'and the run repeats every Tuesday, '.repeat(9)}so a person should turn it down.`;

    await render(<ReviewSurface run={runWith({ confidence: 0.4, suggestedDecision: 'reject', suggestedDecisionReason: long })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('suggested-decision-reason')).toHaveTextContent(long);
  });

  it('keeps the reason apart from the rationale, because they argue different things', async () => {
    // One argues the extraction is right; the other argues the record should
    // still not be in the queue. Merged, they read as the agent contradicting
    // itself on a card it wants turned down.
    await render(
      <ReviewSurface
        run={runWith({ confidence: 0.9, rationale: 'The listing carries a date, a venue and a price.', suggestedDecision: 'reject', suggestedDecisionReason: REASON })}
        crumbs={CRUMBS}
      />,
    );

    await expect.element(page.getByText('The listing carries a date, a venue and a price.')).toBeVisible();
    await expect.element(page.getByTestId('suggested-decision-reason')).toHaveTextContent(REASON);
  });

  it('shows the advice alone for a run proposed before reasons existed', async () => {
    await render(<ReviewSurface run={runWith({ confidence: 0.9, suggestedDecision: 'approve' })} crumbs={CRUMBS} />);

    expect(page.getByTestId('suggested-decision-reason').elements()).toHaveLength(0);

    await expect.element(page.getByTestId('run-details')).toHaveTextContent('Agent suggests approving');
  });

  it('renders no reason when nothing was recommended', async () => {
    // `proposeAction` drops an orphan reason before it is ever stored, so this
    // is the view holding the same line: a sentence arguing for an outcome,
    // with no outcome named, tells a reviewer nothing they can act on.
    await render(<ReviewSurface run={runWith({ confidence: 0.9, suggestedDecisionReason: REASON })} crumbs={CRUMBS} />);

    expect(page.getByTestId('suggested-decision-reason').elements()).toHaveLength(0);
    expect(page.getByText(REASON).elements()).toHaveLength(0);
  });
});
