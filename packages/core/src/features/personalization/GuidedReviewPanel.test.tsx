import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: {
    review: { rewriteDraft: vi.fn(), decideAction: vi.fn(), snoozeAction: vi.fn() },
  },
}));

const { client } = await import('@/libs/Orpc');
const { GuidedReviewPanel } = await import('./GuidedReviewPanel');
const { useGuidedReview } = await import('./GuidedReview');

const RUN = {
  id: 42,
  actionId: 'personalization.enroll',
  status: 'pending',
  input: {},
  invokedBy: null,
  proposal: null,
  card: {
    title: 'New MQL ready to enroll',
    fields: [],
    recommendation: { headline: 'Enroll in: MSP Triage Nurture · 2 sends' },
    verbs: { approve: 'Enroll', reject: 'Decline' },
    content: [
      { kind: 'email', id: 'send-1', label: 'Day 0', subject: 'Ticket volume', body: 'draft one body' },
      { kind: 'email', id: 'send-2', label: 'Day 4', subject: 'Following up', body: 'draft two body' },
    ],
  },
} as unknown as ReviewCardRun;

/**
 * Harness exposing the same hook the dock owns, plus an ask box.
 * @param root0
 * @param root0.onDecided
 */
function Harness({ onDecided }: { onDecided?: () => void } = {}) {
  const guided = useGuidedReview({ run: RUN, ...(onDecided ? { onDecided } : {}) });
  return (
    <div>
      <button type="button" onClick={() => void guided.askAbout('make send 1 shorter')}>ask revise 1</button>
      <button type="button" onClick={() => void guided.askAbout('what is this based on?')}>ask question</button>
      <GuidedReviewPanel run={RUN} guided={guided} />
    </div>
  );
}

beforeEach(() => {
  vi.mocked(client.review.rewriteDraft).mockReset().mockResolvedValue({ body: 'tighter one', input: {} } as never);
  vi.mocked(client.review.decideAction).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(client.review.snoozeAction).mockReset().mockResolvedValue({ ok: true } as never);
});

describe('guided review', () => {
  it('drops the reviewer into send 1, with the overview as context', async () => {
    await render(<Harness />);

    await expect.element(page.getByText('Enroll in: MSP Triage Nurture · 2 sends')).toBeInTheDocument();
    await expect.element(page.getByText('Send 1 of 2 · Day 0')).toBeInTheDocument();
    await expect.element(page.getByText('draft one body')).toBeInTheDocument();
    // No decision until the walk is done.
    await expect.element(page.getByRole('button', { name: 'Enroll' })).not.toBeInTheDocument();
  });

  it('walks to the decision, which names the verbs the card names', async () => {
    await render(<Harness />);

    await userEvent.click(page.getByRole('button', { name: /Looks good · send 2 next/ }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · finish/ }));

    await expect.element(page.getByText('All 2 sends reviewed')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Enroll' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Snooze' })).toBeInTheDocument();
    await expect.element(page.getByText('No changes asked for')).toBeInTheDocument();
  });

  it('a revision re-presents its send and withholds the decision until it is re-read', async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole('button', { name: /Looks good · send 2 next/ }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · finish/ }));

    await expect.element(page.getByText('All 2 sends reviewed')).toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: 'ask revise 1' }));

    // The decision is withdrawn, and the revised send is back with its copy.
    await expect.element(page.getByText('All 2 sends reviewed')).not.toBeInTheDocument();
    await expect.element(page.getByText('Send 1 · v2 · revised')).toBeInTheDocument();
    await expect.element(page.getByText('tighter one')).toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: 'Looks good', exact: true }));

    await expect.element(page.getByText('All 2 sends reviewed')).toBeInTheDocument();
    await expect.element(page.getByText(/1 revision applied: send 1/)).toBeInTheDocument();
  });

  it('a rewrite that changed nothing is not recorded as a revision', async () => {
    // The model returned the draft unchanged (or could not run at all).
    vi.mocked(client.review.rewriteDraft).mockResolvedValue({ body: 'draft one body', input: {} } as never);
    await render(<Harness />);

    await userEvent.click(page.getByRole('button', { name: 'ask revise 1' }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · send 2 next/ }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · finish/ }));

    await expect.element(page.getByText('No changes asked for')).toBeInTheDocument();
    await expect.element(page.getByText(/revision applied/)).not.toBeInTheDocument();
  });

  it('a failed rewrite leaves the copy alone rather than claiming a change', async () => {
    vi.mocked(client.review.rewriteDraft).mockRejectedValue(new Error('no model configured'));
    await render(<Harness />);

    await userEvent.click(page.getByRole('button', { name: 'ask revise 1' }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · send 2 next/ }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · finish/ }));

    await expect.element(page.getByText('No changes asked for')).toBeInTheDocument();
  });

  it('a question changes nothing and is never counted', async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole('button', { name: 'ask question' }));

    expect(client.review.rewriteDraft).not.toHaveBeenCalled();

    await userEvent.click(page.getByRole('button', { name: /Looks good · send 2 next/ }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · finish/ }));

    await expect.element(page.getByText('No changes asked for')).toBeInTheDocument();
  });

  it('approval carries the revised copy to the same decide route the card uses', async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole('button', { name: 'ask revise 1' }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · send 2 next/ }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · finish/ }));

    await userEvent.click(page.getByRole('button', { name: 'Enroll' }));

    expect(client.review.decideAction).toHaveBeenCalledWith(expect.objectContaining({
      id: 42,
      decision: 'approve',
      contentEdits: [{ id: 'send-1', body: 'tighter one' }],
    }));
    await expect.element(page.getByText('Enrolled')).toBeInTheDocument();
  });

  it('the rewrite addresses the named send, not whichever is on screen', async () => {
    await render(<Harness />);

    await userEvent.click(page.getByRole('button', { name: 'ask revise 1' }));

    expect(client.review.rewriteDraft).toHaveBeenCalledWith({
      runId: 42,
      hint: 'make send 1 shorter',
      contentId: 'send-1',
    });
  });

  it('declining requires a note before it will submit', async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole('button', { name: /Looks good · send 2 next/ }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · finish/ }));
    await userEvent.click(page.getByRole('button', { name: 'Decline' }));

    await expect.element(page.getByRole('button', { name: 'Decline with the note' })).toBeDisabled();

    await userEvent.fill(page.getByRole('textbox'), 'wrong angle for this lead');

    await expect.element(page.getByRole('button', { name: 'Decline with the note' })).not.toBeDisabled();

    await userEvent.click(page.getByRole('button', { name: 'Decline with the note' }));

    expect(client.review.decideAction).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'reject',
      note: 'wrong angle for this lead',
    }));
    await expect.element(page.getByText('Declined')).toBeInTheDocument();
  });

  it('a lead decided elsewhere ends the flow with what happened', async () => {
    vi.mocked(client.review.decideAction).mockRejectedValue(new Error('no pending action 42'));
    await render(<Harness />);
    await userEvent.click(page.getByRole('button', { name: /Looks good · send 2 next/ }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · finish/ }));

    await userEvent.click(page.getByRole('button', { name: 'Enroll' }));

    await expect.element(page.getByText('Already decided')).toBeInTheDocument();
    await expect.element(page.getByText(/decided elsewhere/)).toBeInTheDocument();
  });

  it('the flow stays put after a decision so the outcome can be read', async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole('button', { name: /Looks good · send 2 next/ }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · finish/ }));
    await userEvent.click(page.getByRole('button', { name: 'Enroll' }));

    // The decision is gone, the outcome is not.
    await expect.element(page.getByText('Enrolled')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Enroll' })).not.toBeInTheDocument();
  });

  it('snoozing uses the snooze route and names the return', async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole('button', { name: /Looks good · send 2 next/ }));
    await userEvent.click(page.getByRole('button', { name: /Looks good · finish/ }));

    await userEvent.click(page.getByRole('button', { name: 'Snooze' }));

    expect(client.review.snoozeAction).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
    await expect.element(page.getByText('Snoozed')).toBeInTheDocument();
  });
});
