/**
 * OVERTAKEN BY EVENTS, in the shell. What an item was proposed on can change
 * while it waits: the other side writes again, the contact joins a sequence.
 * The shell says so in one line under the decision line, with old → new for
 * what moved, Proceed anyway, and Redraft when the action can redraft (or a
 * plain "next pass" line when its agent will). An approve the server answers
 * STALE is that same line, never a failure.
 */
import type { ReviewCardRun } from './ReviewSurface';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

const decideAction = vi.fn();
const regenerateAction = vi.fn(async (_input: unknown) => ({ ok: true }));
vi.mock('@/libs/Orpc', () => ({
  client: { review: {
    decideAction: (input: unknown) => decideAction(input),
    snoozeAction: vi.fn(),
    regenerateAction: (input: unknown) => regenerateAction(input),
    actionStatus: vi.fn(async () => ({ regeneratingSince: null, regenerateNote: null })),
  } },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/inbox',
}));

const { ReviewSurface } = await import('./ReviewSurface');

const CRUMBS = [{ label: 'Workspace' }, { label: 'Review queue' }, { label: 'Recommendations' }];

function update(over: Partial<ReviewCardRun> = {}): ReviewCardRun {
  return {
    id: 7101,
    actionId: 'hubspot.update',
    status: 'pending',
    input: { properties: { dealstage: 'nurture' } },
    invokedBy: 'agent:revenue-lead',
    proposal: { confidence: 0.8, suggestedDecision: 'approve', suggestedDecisionReason: 'No reply in three weeks.' },
    card: { title: 'Move Phase 2 to Nurture', system: 'HubSpot CRM', fields: [], verbs: { approve: 'Update', reject: 'Decline' }, canRegenerate: true },
    ...over,
  };
}

describe('an item overtaken by events', () => {
  it('says what changed, old to new, under the decision line, and proceeds past it on request', async () => {
    decideAction.mockReset().mockResolvedValue({ ok: true, execution: { status: 'done' } });
    await render(<ReviewSurface run={update({ stale: { line: 'Dana Reyes wrote again on Oct 30', changed: [{ label: 'Deal stage', from: 'Proposal sent', to: 'Negotiation' }], checkedAt: '2026-10-30T10:00:00Z', canRedraft: false } })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('review-stale')).toHaveTextContent('Dana Reyes wrote again on Oct 30');
    await expect.element(page.getByTestId('review-stale-change')).toHaveTextContent('Deal stage: Proposal sent → Negotiation');

    const line = page.getByTestId('review-decision-line').element().getBoundingClientRect();
    const banner = page.getByTestId('review-stale').element().getBoundingClientRect();

    expect(banner.top).toBeGreaterThanOrEqual(line.bottom - 1);
    expect(page.getByTestId('review-stale-redraft').elements()).toHaveLength(0);

    await page.getByTestId('review-stale-proceed').click();

    await vi.waitFor(() => expect(decideAction).toHaveBeenCalled());

    expect(decideAction.mock.calls[0]![0]).toMatchObject({ id: 7101, decision: 'approve', overrideStale: true });
  });

  it('offers Redraft when the action can, and says the next pass will when its agent redrafts', async () => {
    regenerateAction.mockClear();
    const { rerender } = await render(<ReviewSurface run={update({ stale: { line: 'Already in a sequence', checkedAt: '2026-10-30T10:00:00Z', canRedraft: true } })} crumbs={CRUMBS} />);

    await page.getByTestId('review-stale-redraft').click();
    await vi.waitFor(() => expect(regenerateAction).toHaveBeenCalled());

    await rerender(<ReviewSurface run={update({ id: 7102, stale: { line: 'Dana Reyes wrote again', checkedAt: '2026-10-30T10:00:00Z', canRedraft: false, keepOpen: true } })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('review-stale-next-pass')).toHaveTextContent('The agent will redraft on its next pass');
  });

  it('reads an approve answered STALE as the banner, not as a failure', async () => {
    decideAction.mockReset().mockRejectedValue(Object.assign(new Error('Not run: Dana Reyes wrote again on Oct 30'), { code: 'STALE', data: { stale: { line: 'Dana Reyes wrote again on Oct 30', checkedAt: '2026-10-30T10:00:00Z', canRedraft: false } } }));
    await render(<ReviewSurface run={update()} crumbs={CRUMBS} />);

    expect(page.getByTestId('review-stale').elements()).toHaveLength(0);

    await page.getByTestId('decide-approve').click();

    await expect.element(page.getByTestId('review-stale')).toHaveTextContent('Dana Reyes wrote again on Oct 30');
    expect(page.getByTestId('execution-failure').elements()).toHaveLength(0);
  });
});
