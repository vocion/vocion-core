/**
 * What the card says about the agent's recommendation.
 *
 * The badge alone asks a reviewer to take the agent's word for it; the reason
 * beside it is the part they can check against the card in front of them. Both
 * render from the run rather than from the presenter, so no object type can
 * drop them — these tests pin that, plus the two shapes that must render
 * nothing: a run proposed before the reason existed, and a reason that somehow
 * arrived without a recommendation to explain.
 */
import type { ReviewCardRun } from './ReviewActionCard';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: { review: { decideAction: vi.fn(), snooze: vi.fn(), regenerateAction: vi.fn() } },
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const { ReviewActionCard } = await import('./ReviewActionCard');

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
      subject: { name: 'The Flynn' },
      provenance: [{ label: 'Source', value: 'highergroundmusic.com' }],
      contentHeading: { label: 'Candidate' },
      content: [],
      fields: [],
      links: [],
      verbs: { approve: 'Approve', reject: 'Reject' },
    },
  };
}

describe('the agent recommendation on a review card', () => {
  it('shows the reason beside the badge, so the advice can be checked', async () => {
    render(<ReviewActionCard run={runWith({ confidence: 0.9, suggestedDecision: 'reject', suggestedDecisionReason: REASON })} />);

    await expect.element(page.getByText('Agent suggests turning down')).toBeInTheDocument();
    await expect.element(page.getByTestId('suggested-decision-reason')).toHaveTextContent(REASON);
  });

  it('shows the badge alone for a run proposed before reasons existed', async () => {
    // Every card in the queue today is this shape. An empty element under the
    // badge would read as the agent having said something and stopped.
    render(<ReviewActionCard run={runWith({ confidence: 0.9, suggestedDecision: 'approve' })} />);

    await expect.element(page.getByText('Agent suggests approving')).toBeInTheDocument();
    expect(page.getByTestId('suggested-decision-reason').elements()).toHaveLength(0);
  });

  it('renders no reason when nothing was recommended', async () => {
    // `proposeAction` drops an orphan reason before it is ever stored, so this
    // is the view holding the same line: a sentence arguing for an outcome,
    // with no outcome named, tells a reviewer nothing they can act on.
    render(<ReviewActionCard run={runWith({ confidence: 0.9, suggestedDecisionReason: REASON })} />);

    expect(page.getByTestId('suggested-decision-reason').elements()).toHaveLength(0);
    expect(page.getByText(REASON).elements()).toHaveLength(0);
  });
});
