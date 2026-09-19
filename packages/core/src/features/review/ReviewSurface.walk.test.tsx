/**
 * The walk: a check per send, a count over the row, and Enroll held until the
 * count is full.
 *
 * A four-send sequence used to be approved in one click. There was no way to
 * say "I have read send 3", nothing recorded that it was read, and the screen
 * gave a reviewer no sense of progress through the sends it was asking them to
 * vouch for. These assert the walk a reviewer completes — and, just as
 * importantly, the cards that must NOT get one.
 */
import type { ReviewCardRun } from './ReviewSurface';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { contentHash } from '@/libs/actions/contentHash';
import '@/styles/global.css';

const decideAction = vi.fn(async (_input: Record<string, unknown>) => ({ execution: null }));
const approveContent = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true, hash: 'x' }));
const unapproveContent = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }));

vi.mock('@/libs/Orpc', () => ({
  client: {
    review: {
      decideAction: (input: Record<string, unknown>) => decideAction(input),
      snoozeAction: async () => ({ ok: true }),
      regenerateAction: async () => ({ ok: true }),
      approveContent: (input: Record<string, unknown>) => approveContent(input),
      unapproveContent: (input: Record<string, unknown>) => unapproveContent(input),
      actionStatus: async () => ({ regeneratingSince: null, regenerateNote: null }),
    },
  },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/inbox',
}));

const { ReviewSurface } = await import('./ReviewSurface');
const stories = await import('./ReviewSurface.stories');

const CRUMBS = [{ label: 'Workspace', href: '/dashboard' }, { label: 'Review queue' }];

const sendBody = (n: number) => `Body of send ${n}.`;
const sendSubject = (n: number) => `Subject ${n}`;

function enrollment(n: number, over: Partial<ReviewCardRun> = {}): ReviewCardRun {
  return {
    id: 501,
    actionId: 'personalization.enroll',
    status: 'pending',
    input: {},
    invokedBy: 'agent:revenue-lead',
    proposal: { confidence: 0.6, rationale: 'The careers page names two live-ops roles.' },
    card: {
      title: 'New MQL ready to enroll',
      subject: { name: 'Rowan Pike', role: 'Founder & CEO', company: 'Tideline Gaming' },
      content: Array.from({ length: n }, (_, i) => ({
        kind: 'email' as const,
        id: `send-${i + 1}`,
        label: `Day ${i * 3}`,
        subject: sendSubject(i + 1),
        body: sendBody(i + 1),
      })),
      fields: [],
      verbs: { approve: 'Enroll', reject: 'Decline' },
      canRegenerate: true,
    },
    ...over,
  };
}

/**
 * The check the server would have stored for send `n`, unedited.
 * @param n
 * @param at
 */
const checkFor = (n: number, at = '2026-09-18T12:00:00.000Z') =>
  ({ [`send-${n}`]: { hash: contentHash(sendSubject(n), sendBody(n)), at } });

beforeEach(() => {
  decideAction.mockClear();
  approveContent.mockClear();
  unapproveContent.mockClear();
});

describe('a check per send', () => {
  it('checks the tab, raises the count and advances to the next unapproved send', async () => {
    await render(<ReviewSurface run={enrollment(4)} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('0 of 4 approved');

    await page.getByTestId('approve-send-1').click();

    await vi.waitFor(() => expect(approveContent).toHaveBeenCalled());

    expect(approveContent.mock.calls[0]![0]).toMatchObject({ id: 501, contentId: 'send-1', subject: sendSubject(1), body: sendBody(1) });
    await expect.element(page.getByTestId('tab-check-send-1')).toBeVisible();
    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('1 of 4 approved');
    // The advance is what makes it a walk: the next thing it is asking you to
    // vouch for is now in front of you.
    await expect.element(page.getByTestId('item-pane-send-2')).toBeVisible();
  });

  it('leaves you on the last send rather than advancing nowhere', async () => {
    await render(<ReviewSurface run={enrollment(2, { contentReview: checkFor(1) })} crumbs={CRUMBS} />);

    await page.getByTestId('tab-item-send-2').click();
    await page.getByTestId('approve-send-2').click();

    await vi.waitFor(() => expect(approveContent).toHaveBeenCalled());

    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('2 of 2 approved');
    await expect.element(page.getByTestId('item-pane-send-2')).toBeVisible();
  });

  it('carries the reviewer\'s edited copy into the approval, not the agent\'s', async () => {
    await render(<ReviewSurface run={enrollment(2)} crumbs={CRUMBS} />);

    const body = page.getByTestId('email-pane-send-1').element().querySelector('textarea')!;
    await page.elementLocator(body).fill('Tightened.');
    await page.getByTestId('approve-send-1').click();

    await vi.waitFor(() => expect(approveContent).toHaveBeenCalled());

    expect(approveContent.mock.calls[0]![0]).toMatchObject({ contentId: 'send-1', body: 'Tightened.' });
  });

  it('keeps the checks and the count a reload lands with', async () => {
    // The server's record IS the check: the surface seeds from the run, so a
    // reload and a second window agree without asking.
    await render(<ReviewSurface run={enrollment(4, { contentReview: { ...checkFor(1), ...checkFor(2) } })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('2 of 4 approved');
    await expect.element(page.getByTestId('tab-check-send-1')).toBeVisible();
    await expect.element(page.getByTestId('tab-check-send-2')).toBeVisible();
    expect(page.getByTestId('tab-item-send-3').element().getAttribute('data-approved')).toBeNull();
  });

  it('takes a check back off without touching the payload', async () => {
    await render(<ReviewSurface run={enrollment(2, { contentReview: checkFor(1) })} crumbs={CRUMBS} />);

    await page.getByTestId('unapprove-send-1').click();

    await vi.waitFor(() => expect(unapproveContent).toHaveBeenCalled());

    expect(unapproveContent.mock.calls[0]![0]).toMatchObject({ id: 501, contentId: 'send-1' });
    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('0 of 2 approved');
    expect(decideAction).not.toHaveBeenCalled();
  });

  it('sends nothing: approving every send never decides the run', async () => {
    await render(<ReviewSurface run={enrollment(2)} crumbs={CRUMBS} />);

    await page.getByTestId('approve-send-1').click();
    await vi.waitFor(() => expect(approveContent).toHaveBeenCalledTimes(1));
    await page.getByTestId('approve-send-2').click();
    await vi.waitFor(() => expect(approveContent).toHaveBeenCalledTimes(2));

    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('2 of 2 approved');
    expect(decideAction).not.toHaveBeenCalled();
  });
});

describe('a check is not a promise', () => {
  it('clears when an approved send\'s body is edited, with no page load', async () => {
    await render(<ReviewSurface run={enrollment(2, { contentReview: checkFor(1) })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('tab-check-send-1')).toBeVisible();

    const body = page.getByTestId('email-pane-send-1').element().querySelector('textarea')!;
    await page.elementLocator(body).fill('Changed after approval.');

    await vi.waitFor(() => expect(page.getByTestId('tab-item-send-1').element().getAttribute('data-approved')).toBeNull());

    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('0 of 2 approved');
  });

  it('clears when a regeneration replaced the copy under it, with no page load', async () => {
    // The redraft landed: the run now carries the new body, and the check was
    // given for the old one. Nothing cleared it — it no longer refers to this.
    const stale = { 'send-1': { hash: contentHash(sendSubject(1), 'The body that was approved.'), at: '2026-09-18T12:00:00.000Z' } };
    await render(<ReviewSurface run={enrollment(2, { contentReview: stale })} crumbs={CRUMBS} />);

    expect(page.getByTestId('tab-item-send-1').element().getAttribute('data-approved')).toBeNull();
    await expect.element(page.getByTestId('walk-count')).toHaveTextContent('0 of 2 approved');
  });

  it('comes back when the copy is edited back to what was approved', async () => {
    await render(<ReviewSurface run={enrollment(2, { contentReview: checkFor(1) })} crumbs={CRUMBS} />);

    const body = page.getByTestId('email-pane-send-1').element().querySelector('textarea')!;
    await page.elementLocator(body).fill('Changed.');
    await vi.waitFor(() => expect(page.getByTestId('tab-item-send-1').element().getAttribute('data-approved')).toBeNull());

    await page.elementLocator(body).fill(sendBody(1));

    await vi.waitFor(() => expect(page.getByTestId('tab-item-send-1').element().getAttribute('data-approved')).toBe('true'));
  });

  it('brings an approved send\'s edited copy back with its check', async () => {
    // Approving a send you just edited records the edited copy. Without the
    // rehydration the reload would render the agent's body, the hash would
    // not match, and the check a reviewer earned would be gone unexplained.
    const approvedBody = 'The copy the reviewer edited, then approved.';
    await render(
      <ReviewSurface
        run={enrollment(2, {
          contentReview: { 'send-1': { hash: contentHash(sendSubject(1), approvedBody), at: '2026-09-18T12:00:00.000Z' } },
          revisions: [{ contentId: 'send-1', version: 2, kind: 'approved', body: approvedBody, at: '2026-09-18T12:00:00.000Z' }],
        })}
        crumbs={CRUMBS}
      />,
    );

    await expect.element(page.getByTestId('tab-check-send-1')).toBeVisible();
    expect(page.getByTestId('email-pane-send-1').element().querySelector('textarea')!.value).toBe(approvedBody);
  });
});

describe('Enroll is held until the count is full', () => {
  it('disables the primary and says why, on the button and in a notice', async () => {
    await render(<ReviewSurface run={enrollment(4, { contentReview: { ...checkFor(1), ...checkFor(2) } })} crumbs={CRUMBS} />);

    const primary = page.getByTestId('decide-approve').element();

    expect(primary).toBeDisabled();

    // On the button: a disabled control takes no pointer events, so the
    // reason rides a wrapper that still hovers, and an aria-describedby so it
    // is not hover-only.
    const hint = document.getElementById(primary.getAttribute('aria-describedby')!);

    expect(hint?.textContent).toContain('2 of 4');
    await expect.element(page.getByTestId('primary-held')).toHaveTextContent('Enroll is held.');
    await expect.element(page.getByTestId('primary-held')).toHaveTextContent('2 of 4');
  });

  it('releases at the full count', async () => {
    await render(<ReviewSurface run={enrollment(2, { contentReview: { ...checkFor(1), ...checkFor(2) } })} crumbs={CRUMBS} />);

    expect(page.getByTestId('decide-approve').element()).not.toBeDisabled();
    expect(page.getByTestId('primary-held').elements()).toHaveLength(0);
  });

  it('releases as the last send is approved, without a reload', async () => {
    await render(<ReviewSurface run={enrollment(2, { contentReview: checkFor(1) })} crumbs={CRUMBS} />);

    expect(page.getByTestId('decide-approve').element()).toBeDisabled();

    await page.getByTestId('tab-item-send-2').click();
    await page.getByTestId('approve-send-2').click();

    await vi.waitFor(() => expect(page.getByTestId('decide-approve').element()).not.toBeDisabled());
  });

  it('holds again when an approved send is edited back out of its check', async () => {
    await render(<ReviewSurface run={enrollment(2, { contentReview: { ...checkFor(1), ...checkFor(2) } })} crumbs={CRUMBS} />);

    expect(page.getByTestId('decide-approve').element()).not.toBeDisabled();

    const body = page.getByTestId('email-pane-send-1').element().querySelector('textarea')!;
    await page.elementLocator(body).fill('Changed after approval.');

    await vi.waitFor(() => expect(page.getByTestId('decide-approve').element()).toBeDisabled());
  });

  it('a does not bypass it', async () => {
    await render(<ReviewSurface run={enrollment(4, { contentReview: checkFor(1) })} crumbs={CRUMBS} />);

    (document.activeElement as HTMLElement)?.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    await new Promise(r => setTimeout(r, 50));

    expect(decideAction).not.toHaveBeenCalled();
  });

  it('never holds a retry — that run was already decided once', async () => {
    // The execution failed, not the reading. The decision's backstop already
    // recorded what was approved, and making someone walk four sends again to
    // re-send copy they approved is the count blocking a queue.
    await render(<ReviewSurface run={enrollment(4, { status: 'failed', error: 'HubSpot rejected the enrolment.' })} crumbs={CRUMBS} />);

    expect(page.getByTestId('decide-approve').element()).not.toBeDisabled();
    await expect.element(page.getByTestId('decide-approve')).toHaveTextContent('Retry Enroll');
  });

  it('lets a surface\'s own hold outrank the walk\'s', async () => {
    await render(
      <ReviewSurface
        run={enrollment(2, { contentReview: checkFor(1) })}
        crumbs={CRUMBS}
        hold={{ reason: 'The sequence is paused in HubSpot.' }}
      />,
    );

    // That one says the consequence cannot be determined at all, which
    // outranks "you have not finished reading".
    await expect.element(page.getByTestId('primary-held')).toHaveTextContent('The sequence is paused in HubSpot.');
    expect(page.getByTestId('decide-approve').element()).toBeDisabled();
  });

  it('never holds a card that does not walk', async () => {
    await render(<ReviewSurface run={enrollment(1)} crumbs={CRUMBS} />);

    expect(page.getByTestId('decide-approve').element()).not.toBeDisabled();
    expect(page.getByTestId('primary-held').elements()).toHaveLength(0);
  });
});

describe('every object type, through the same shell', () => {
  // The seven presenter types as the stories mount them, so the scope rule is
  // checked against the real cards rather than against a fixture written to
  // agree with it. Only a sequence walks; the other six are untouched, which
  // is the promise this plan made about them.
  const TYPES = [
    { name: 'MQL enrollment (3 sends)', story: () => stories.MqlEnrollment, walks: true },
    { name: 'six sends', story: () => stories.SixSends, walks: true },
    { name: 'follow-up email (one item)', story: () => stories.FollowUpEmail, walks: false },
    { name: 'CRM update (no content)', story: () => stories.CrmUpdate, walks: false },
    { name: 'discovery proposal', story: () => stories.DiscoveryProposal, walks: false },
    { name: 'extracted candidate', story: () => stories.ExtractedCandidate, walks: false },
    { name: 'kit verification (one photo)', story: () => stories.KitVerification, walks: false },
    { name: 'proposal document', story: () => stories.ProposalDocument, walks: false },
  ];

  for (const type of TYPES) {
    it(`${type.walks ? 'walks' : 'does not walk'} ${type.name}`, async () => {
      const args = type.story().args as { run: ReviewCardRun; crumbs?: typeof CRUMBS };
      await render(<ReviewSurface run={args.run} crumbs={CRUMBS} />);

      if (type.walks) {
        await expect.element(page.getByTestId('walk-count')).toBeVisible();
        // Held on arrival: nothing has been approved yet.
        expect(page.getByTestId('decide-approve').element()).toBeDisabled();
      } else {
        expect(page.getByTestId('walk-count').elements()).toHaveLength(0);
        expect(page.getByTestId('primary-held').elements()).toHaveLength(0);
        expect(page.getByTestId('decide-approve').element()).not.toBeDisabled();
      }
    });
  }
});

describe('where the walk applies', () => {
  it('shows no checks and no count on a one-item card', async () => {
    await render(<ReviewSurface run={enrollment(1)} crumbs={CRUMBS} />);

    expect(page.getByTestId('walk-count').elements()).toHaveLength(0);
    expect(page.getByTestId('approve-send-1').elements()).toHaveLength(0);
    expect(page.getByTestId('decide-approve').element()).not.toBeDisabled();
  });

  it('shows no checks and no count on a card with no content', async () => {
    const run = enrollment(0);
    await render(<ReviewSurface run={{ ...run, card: { ...run.card, content: [] } }} crumbs={CRUMBS} />);

    expect(page.getByTestId('walk-count').elements()).toHaveLength(0);
    expect(page.getByTestId('decide-approve').element()).not.toBeDisabled();
  });
});
