/**
 * ONE SHAPE FOR A RULING (Chris, 2026-09-29, proposal 5210: "The chips don't
 * match anything on Decide in review."). A pending `ask.file` with options is
 * decided on the review page by the same choices the chat card offers —
 * recommended first and primary — sent the same way (the option id as the
 * filing's `answer`), in place of Ask / Do not ask. Snooze stays. Fictional.
 */
import type { ReviewCardRun } from './ReviewSurface';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

const decideAction = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true }));
vi.mock('@/libs/Orpc', () => ({
  client: { review: { decideAction, snoozeAction: vi.fn(), regenerateAction: vi.fn(), actionStatus: vi.fn() } },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/inbox',
}));

const { ReviewSurface } = await import('./ReviewSurface');

const INPUT = {
  title: 'Copy-link on locked rows?',
  kind: 'ruling',
  options: [
    { id: 'disabled', label: 'Show disabled' },
    { id: 'upsell', label: 'Show with upsell' },
    { id: 'hide', label: 'Hide on locked rows', recommended: true },
  ],
};

function ruling(status = 'pending'): ReviewCardRun {
  return {
    id: 52,
    actionId: 'ask.file',
    status,
    invokedBy: 'agent:product-manager',
    proposal: { confidence: 0.7 },
    input: INPUT,
    card: { title: 'Ask: Copy-link on locked rows?', system: 'Ask', fields: [], links: [], verbs: { approve: 'Ask', reject: 'Do not ask' } },
  };
}

beforeEach(() => {
  decideAction.mockReset();
  decideAction.mockResolvedValue({ ok: true });
});

describe('a ruling on the review page', () => {
  it('the primary is the recommended option: `a` chooses it', async () => {
    const { userEvent } = await import('vitest/browser');
    await render(<ReviewSurface run={ruling()} crumbs={[{ label: 'Review queue' }]} />);

    await expect.element(page.getByRole('button', { name: 'Hide on locked rows' })).toBeInTheDocument();

    await userEvent.keyboard('a');

    await expect.poll(() => decideAction.mock.calls.length).toBe(1);
    expect(decideAction).toHaveBeenCalledWith(expect.objectContaining({ decision: 'approve', editedInput: { ...INPUT, answer: 'hide' } }));
  });

  it('offers its options as the bar\'s buttons, recommended first, and no Ask / Do not ask', async () => {
    await render(<ReviewSurface run={ruling()} crumbs={[{ label: 'Review queue' }]} />);

    const choices = page.getByTestId('ruling-choice').elements().map(e => e.textContent?.trim() ?? '');

    expect(choices).toHaveLength(3);
    expect(choices.join('|')).toContain('Hide on locked rows');
    expect(choices.join('|')).toContain('Show with upsell');
    expect(choices.join('|')).toContain('Show disabled');
    expect(page.getByRole('button', { name: /^Do not ask/ }).elements()).toHaveLength(0);
    expect(page.getByTestId('decide-approve').elements()).toHaveLength(0);
    await expect.element(page.getByTestId('decide-snooze')).toBeInTheDocument();
  });

  it('decides exactly as the chat card does: approve, with the option id as the answer', async () => {
    await render(<ReviewSurface run={ruling()} crumbs={[{ label: 'Review queue' }]} />);

    await page.getByRole('button', { name: 'Show with upsell' }).click();

    await expect.poll(() => decideAction.mock.calls.length).toBe(1);
    expect(decideAction).toHaveBeenCalledWith(expect.objectContaining({ id: 52, decision: 'approve', editedInput: { ...INPUT, answer: 'upsell' } }));
  });
});
