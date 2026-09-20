import type { SelfUpdateReceipt } from '@/libs/actions/selfUpdate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

/**
 * The chip that says the system improved ITSELF during a turn, and its Undo.
 *
 * Two things are worth a browser rather than a unit test: that several
 * self-updates in one turn produce ONE chip rather than a stack, and that the
 * Undo on it calls the same RPC the review queue does — because the whole
 * argument for letting these run without a person is that one click puts them
 * back, from where the person read about them.
 */

vi.mock('@/libs/Orpc', () => ({
  client: { review: { undoAction: vi.fn() } },
}));

const { client } = await import('@/libs/Orpc');
const { SelfUpdateChips } = await import('./SelfUpdateChips');

const wiki: SelfUpdateReceipt = { runId: 41, noun: 'wiki', target: 'Founder voice', change: 'v3', status: 'applied' };
const prompt: SelfUpdateReceipt = { runId: 42, noun: 'prompt', target: 'Proposal Writer', change: '+12 −4 lines', status: 'applied' };
const queued: SelfUpdateReceipt = { runId: 43, noun: 'playbook', target: 'Discovery summary', status: 'proposed' };

beforeEach(() => {
  vi.mocked(client.review.undoAction).mockReset().mockResolvedValue({ ok: true, status: 'undone' } as never);
});

describe('the self-update chip', () => {
  it('says what it did, in one line, where it happened', async () => {
    await render(<SelfUpdateChips updates={[wiki]} />);

    await expect.element(page.getByText('Updated the wiki · Founder voice · v3')).toBeInTheDocument();
  });

  it('puts it back with one click, through the same undo the review queue uses', async () => {
    await render(<SelfUpdateChips updates={[wiki]} />);

    await userEvent.click(page.getByTestId('self-update-undo-41'));

    expect(client.review.undoAction).toHaveBeenCalledWith({ id: 41 });
    await expect.element(page.getByText('Updated the wiki · Founder voice · v3 · undone')).toBeInTheDocument();
  });

  it('offers no Undo for a self-update still waiting on a person', async () => {
    await render(<SelfUpdateChips updates={[queued]} />);

    expect(page.getByTestId('self-update-undo-43').query()).toBeNull();
    await expect.element(page.getByText('Revised a playbook · Discovery summary — waiting on you')).toBeInTheDocument();
  });

  it('groups several updates from one turn into ONE chip that counts them', async () => {
    await render(<SelfUpdateChips updates={[wiki, prompt, queued]} />);

    await expect.element(page.getByTestId('self-update-chip')).toBeInTheDocument();
    await expect.element(page.getByText('Taught itself 3 things · 1 waiting on you')).toBeInTheDocument();
    // Nothing is listed until it is opened — one quiet line, not a stack.
    expect(page.getByTestId('self-update-list').query()).toBeNull();
  });

  it('lists the group on demand, each entry undoable on its own', async () => {
    await render(<SelfUpdateChips updates={[wiki, prompt, queued]} />);

    await userEvent.click(page.getByTestId('self-update-chip'));

    await expect.element(page.getByTestId('self-update-list')).toBeInTheDocument();
    await expect.element(page.getByText('Revised its own instructions · Proposal Writer · +12 −4 lines')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('self-update-undo-42'));

    expect(client.review.undoAction).toHaveBeenCalledWith({ id: 42 });
    // The other entry is untouched: undo is per self-update, not per turn.
    await expect.element(page.getByTestId('self-update-undo-41')).toBeInTheDocument();
  });

  it('says so and stays clickable when an undo fails', async () => {
    vi.mocked(client.review.undoAction).mockRejectedValue(new Error('run is not done'));
    await render(<SelfUpdateChips updates={[wiki]} />);

    await userEvent.click(page.getByTestId('self-update-undo-41'));

    await expect.element(page.getByText('Undo failed — retry')).toBeInTheDocument();
  });

  it('renders nothing for a turn that taught itself nothing', async () => {
    await render(<SelfUpdateChips updates={[]} />);

    expect(page.getByTestId('self-update-chip').query()).toBeNull();
  });
});
