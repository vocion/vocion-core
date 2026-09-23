/**
 * The flat review template, asserted where it is claimed.
 *
 * The claim this file holds: ONE shell draws every object type, and the zones
 * a type must not be able to drop — the meta row, Why, Evidence, the three
 * verbs — are built from the RUN, so a presenter that says nothing still
 * produces them. The counts are deliberately parameterised over 3 to 6 content
 * items, because a sequence is the shape that grows.
 */
import type { ReviewCardRun } from './ReviewSurface';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { publishDraftRevision } from '@/features/personalization/draftRevision';
import { contentHash } from '@/libs/actions/contentHash';
import { canonicalBody } from './contentWalk';
// The real stylesheet, so the layout claims below are about geometry rather
// than about class names (`ReviewHeader.layout.test.tsx` sets the precedent).
import '@/styles/global.css';

const decideAction = vi.fn(async (_input: Record<string, unknown>) => ({ execution: null }));
const snoozeAction = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }));
const regenerateAction = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }));

vi.mock('@/libs/Orpc', () => ({
  client: {
    review: {
      decideAction: (input: Record<string, unknown>) => decideAction(input),
      snoozeAction: (input: Record<string, unknown>) => snoozeAction(input),
      regenerateAction: (input: Record<string, unknown>) => regenerateAction(input),
      approveContent: async () => ({ ok: true, hash: 'x' }),
      unapproveContent: async () => ({ ok: true }),
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

const CRUMBS = [{ label: 'Workspace', href: '/dashboard' }, { label: 'Review queue', href: '/dashboard/inbox' }, { label: 'Recommendations' }];

/**
 * The same run with its walk already complete, for the tests that are about
 * something other than the walk. Phase 4 holds the primary until every send
 * carries a check, so a card that is not the subject of a test arrives with
 * them rather than having the assertion weakened around it.
 * @param run - The run to stamp as fully approved.
 */
function approved(run: ReviewCardRun): ReviewCardRun {
  return {
    ...run,
    contentReview: Object.fromEntries((run.card.content ?? [])
      .filter(i => i.kind === 'email')
      .map(i => [i.id, { hash: contentHash(i.kind === 'email' ? i.subject : undefined, canonicalBody(i.kind === 'email' ? i.body : '')), at: '2026-09-18T12:00:00.000Z' }])),
  };
}

/**
 * An enrollment run with `n` sends — the shape that grows.
 * @param n
 * @param over
 */
function enrollment(n: number, over: Partial<ReviewCardRun> = {}): ReviewCardRun {
  return {
    id: 501,
    actionId: 'personalization.enroll',
    status: 'pending',
    input: {},
    invokedBy: 'agent:revenue-lead',
    proposal: {
      confidence: 0.58,
      rationale: 'The careers page names two live-ops roles beside a studio launch.',
      evidence: ['https://tideline.example/careers'],
    },
    card: {
      title: 'New MQL ready to enroll',
      system: 'Personalization',
      subject: { name: 'Rowan Pike', role: 'Founder & CEO', company: 'Tideline Gaming' },
      provenance: [{ label: 'Source', value: 'Paid social' }, { label: 'Campaign', value: 'LinkedIn' }],
      recommendationLabel: 'Sequence to enroll',
      recommendation: { headline: 'Ebook Inbound Nurture', detail: 'An existing sequence, personalized.' },
      content: Array.from({ length: n }, (_, i) => ({
        kind: 'email' as const,
        id: `send-${i + 1}`,
        label: `Day ${i * 3}`,
        subject: `Subject ${i + 1}`,
        body: `Body of send ${i + 1}.`,
      })),
      fields: [{ label: 'On Enroll', value: 'The contact is enrolled' }],
      links: [{ label: 'View research', href: '/gtm/lead/88201' }],
      verbs: { approve: 'Confirm', reject: 'Decline' },
      canRegenerate: true,
    },
    ...over,
  };
}

/** A fields-only run — no content, editable properties. */
const CRM_UPDATE: ReviewCardRun = {
  id: 502,
  actionId: 'hubspot.update',
  status: 'pending',
  input: { properties: { industry: 'Games', notes: 'Two live-ops roles open.' } },
  invokedBy: 'agent:revenue-lead',
  proposal: { confidence: 0.72, rationale: 'The careers page names the roles.' },
  card: {
    title: 'Update HubSpot contact record',
    system: 'HubSpot CRM',
    fields: [{ label: 'Record', value: 'contacts:88201' }],
    verbs: { approve: 'Update', reject: 'Decline' },
  },
};

describe('one flat template, every object type', () => {
  it('draws no bordered surface inside another — hairlines, not boxes', async () => {
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} position="28 of 224" />);

    await expect.element(page.getByTestId('review-surface')).toBeVisible();

    // The page itself is the surface. Nothing inside it repeats the frame:
    // no `rounded-*` + `border` ground, on any depth.
    const root = page.getByTestId('review-surface').element();
    const boxes = [...root.querySelectorAll<HTMLElement>('div, section, article, aside')].filter((el) => {
      const s = getComputedStyle(el);
      const radius = Number.parseFloat(s.borderTopLeftRadius) || 0;
      const width = Number.parseFloat(s.borderTopWidth) || 0;
      const bottom = Number.parseFloat(s.borderBottomWidth) || 0;
      const left = Number.parseFloat(s.borderLeftWidth) || 0;
      const right = Number.parseFloat(s.borderRightWidth) || 0;
      // A box is a frame on all four sides. A hairline above, below or beside
      // is the pattern, not a violation.
      return radius > 0 && width > 0 && bottom > 0 && left > 0 && right > 0;
    });

    expect(boxes.map(b => b.className)).toEqual([]);
  });

  it.each([3, 4, 5, 6])('turns n=%s content items into exactly n tabs, and nothing else', async (n) => {
    await render(<ReviewSurface run={enrollment(n)} crumbs={CRUMBS} />);

    const tabs = page.getByTestId('review-tabs').element().querySelectorAll('[data-slot="tabs-trigger"]');
    const labels = [...tabs].map(t => t.textContent);

    // The strip is what there is to review. Why and Evidence are on the page,
    // under the content, not two tabs beside the four a reviewer came for.
    expect(labels).toEqual(Array.from({ length: n }, (_, i) => `Day ${i * 3}`));
    await expect.element(page.getByTestId('why-pane')).toBeVisible();
    await expect.element(page.getByTestId('evidence-pane')).toBeVisible();
  });

  it.each([3, 4, 5, 6])('keeps every one of n=%s item tabs reachable and on one row', async (n) => {
    await render(<ReviewSurface run={enrollment(n)} crumbs={CRUMBS} />);

    const list = page.getByTestId('review-tabs').element();
    const triggers = [...list.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]')];
    // One row: every trigger shares the first one's top edge. A wrapped row is
    // what pushes the panes down a line as the sequence grows.
    const tops = new Set(triggers.map(t => Math.round(t.getBoundingClientRect().top)));

    expect(tops.size).toBe(1);

    // And each one opens its own pane.
    for (let i = 0; i < n; i++) {
      await page.getByTestId(`tab-item-send-${i + 1}`).click();

      await expect.element(page.getByTestId(`item-pane-send-${i + 1}`)).toBeVisible();
    }
  });

  it('puts Changes first when the type carries fields rather than content', async () => {
    await render(<ReviewSurface run={CRM_UPDATE} crumbs={CRUMBS} />);

    const labels = [...page.getByTestId('review-tabs').element().querySelectorAll('[data-slot="tabs-trigger"]')].map(t => t.textContent);

    expect(labels).toEqual(['Changes']);
    await expect.element(page.getByTestId('changes-pane')).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'notes' })).toBeVisible();
  });

  it('builds Why and Evidence from the run even when the presenter says nothing, and with no strip at all', async () => {
    const bare: ReviewCardRun = {
      id: 503,
      actionId: 'x.y',
      status: 'pending',
      input: {},
      invokedBy: null,
      proposal: null,
      card: { title: 'Bare card', fields: [] },
    };
    await render(<ReviewSurface run={bare} crumbs={CRUMBS} />);

    // Nothing to review on this card, so there is no strip — and the dossier
    // is the whole screen rather than a lone tab a reviewer has to open.
    expect(page.getByTestId('review-tabs').elements()).toHaveLength(0);
    await expect.element(page.getByText('No rationale recorded for this recommendation.')).toBeVisible();
    await expect.element(page.getByText('No citations recorded.')).toBeVisible();
    await expect.element(page.getByTestId('run-details')).toBeVisible();
  });

  it('shows provenance, the recommendation and confidence on ONE row', async () => {
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} position="28 of 224" />);

    const row = page.getByTestId('review-meta').element();

    expect(row.textContent).toContain('Source');
    expect(row.textContent).toContain('Paid social');
    expect(row.textContent).toContain('Sequence to enroll');
    expect(row.textContent).toContain('Ebook Inbound Nurture');
    expect(row.querySelector('[data-testid="confidence-meter"]')).not.toBeNull();
    // The queue position sits beside the name, not in the meta row.
    expect(row.textContent).not.toContain('28 of 224');
    await expect.element(page.getByTestId('queue-position')).toBeVisible();
  });

  it('shows provenance only when there is no recommendation', async () => {
    const noRec = enrollment(3);
    delete noRec.card.recommendation;
    delete noRec.card.recommendationLabel;
    await render(<ReviewSurface run={noRec} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('review-meta')).toBeVisible();
    expect(page.getByTestId('meta-recommendation').elements()).toHaveLength(0);
  });

  it('draws no meta row at all when there is neither', async () => {
    const neither = enrollment(3);
    delete neither.card.recommendation;
    delete neither.card.provenance;
    await render(<ReviewSurface run={neither} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('review-tabs')).toBeVisible();
    expect(page.getByTestId('review-meta').elements()).toHaveLength(0);
  });

  it('offers four controls on the bar and no more — Save for later and Skip are gone', async () => {
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} />);

    const bar = page.getByTestId('sticky-action-bar').element();
    // The kbd shortcut chip is decorative and sits inside the button, so read
    // the label span rather than the whole node.
    const labels = [...bar.querySelectorAll('button')].map(b => (b.querySelector('span')?.textContent ?? b.textContent ?? '').trim());

    // "Add a note", not "Add feedback": the bar's box is about the DECISION,
    // and the box that asks for a rewrite now sits beside the copy it is
    // about. Two boxes, named as two jobs.
    // The primary reads Approve here rather than the card's verb because a
    // three-send card walks, and the walk IS the primary until the count is
    // full (`ReviewSurface.walk.test.tsx`). Four controls either way.
    expect(labels).toEqual(['Add a note', 'Decline', 'Snooze', 'Approve']);
    expect(bar.textContent).not.toContain('Save for later');
    expect(bar.textContent).not.toContain('Skip');
  });

  it('gives a long record name the whole title row when the header carries no controls', async () => {
    // The live defect: the queue controls (position, Back, and an Up next
    // that renders the WHOLE next item's name) took most of the row, so the
    // title fell back to its 20rem basis and a three-word heading wrapped
    // onto three lines. The controls were costing the thing they sat beside.
    await render(
      <ReviewSurface
        run={approved(enrollment(3))}
        crumbs={CRUMBS}
        title="Enroll MQL in sequence — Musa Raza · Digital Dost (Pvt.) Limited"
        subtitle="Founder & CEO · Digital Dost (Pvt.) Limited"
      />,
    );

    const heading = page.getByRole('heading', { level: 1 }).element();
    const row = heading.parentElement!.parentElement!;

    // Not pinned to the 320px basis: the name gets the row it is the subject of.
    expect(heading.getBoundingClientRect().width).toBeGreaterThan(row.getBoundingClientRect().width * 0.8);
  });

  it('decides from the keyboard, and never while you are typing', async () => {
    decideAction.mockClear();
    // A walk this card has already completed, so the keyboard test is about
    // the keyboard. That `a` cannot bypass an INCOMPLETE walk is asserted in
    // ReviewSurface.walk.test.tsx, where the hold is the subject.
    await render(<ReviewSurface run={approved(enrollment(3))} crumbs={CRUMBS} />);

    // The body is a contenteditable now, which is neither an input nor a
    // textarea — `shortcutFor` refuses it on `isContentEditable`, and this is
    // what proves the refusal still covers the field a reviewer types in.
    page.getByTestId('email-pane-send-1').element().querySelector<HTMLElement>('[contenteditable="true"]')!.focus();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(decideAction).not.toHaveBeenCalled();

    (document.activeElement as HTMLElement)?.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await vi.waitFor(() => expect(decideAction).toHaveBeenCalledTimes(1));

    expect(decideAction.mock.calls[0]![0]).toMatchObject({ id: 501, decision: 'approve' });
  });

  it('carries an edit made inside a tab onto Confirm, on every editable item', async () => {
    decideAction.mockClear();
    await render(<ReviewSurface run={enrollment(4)} crumbs={CRUMBS} />);

    // Edit the third send, in its own tab, after switching away and back.
    await page.getByTestId('tab-item-send-3').click();
    const body = page.getByTestId('email-pane-send-3').element().querySelector('[contenteditable="true"]')!;
    await page.getByTestId('tab-item-send-1').click();
    await page.getByTestId('tab-item-send-3').click();
    const live = page.getByTestId('email-pane-send-3').element().querySelector<HTMLElement>('[contenteditable="true"]')!;
    await page.elementLocator(live).fill('Rewritten in the tab.');

    // Each send it edited is then approved, which is the walk's real path and
    // what turns the primary into the card's verb. Same button every time:
    // approving one advances to the next.
    for (const id of ['send-1', 'send-2', 'send-3', 'send-4']) {
      await page.getByTestId(`tab-item-${id}`).click();
      await page.getByTestId('decide-approve').click();
      await vi.waitFor(() => expect(page.getByTestId(`tab-item-${id}`).element().getAttribute('data-approved')).toBe('true'));
    }

    await page.getByTestId('decide-approve').click();
    await vi.waitFor(() => expect(decideAction).toHaveBeenCalled());

    expect(body).toBeTruthy();
    expect(decideAction.mock.calls[0]![0]).toMatchObject({
      decision: 'approve',
      contentEdits: [{ id: 'send-3', body: '<p>Rewritten in the tab.</p>' }],
    });
  });

  it('puts Regenerate beside the item and names it', async () => {
    regenerateAction.mockClear();
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} />);

    await page.getByTestId('tab-item-send-2').click();

    // One word on the button; the accessible name still names the send.
    await expect.element(page.getByTestId('regenerate-send-2')).toHaveTextContent('Regenerate');

    expect(page.getByTestId('regenerate-send-2').element().getAttribute('aria-label')).toBe('Regenerate Day 3');
    // Not on the bar: one Regenerate there means whichever item its author had in mind.
    expect(page.getByTestId('sticky-action-bar').element().textContent).not.toContain('Regenerate');

    // No disclosure to open — the instruction box is the right column, and it
    // is open, because a control that hides the copy it acts on was the
    // defect this layout fixes.
    await page.getByRole('textbox', { name: 'Regenerate instruction for Day 3' }).fill('Soften the ask.');
    await page.getByTestId('regenerate-send-2').click();

    await vi.waitFor(() => expect(regenerateAction).toHaveBeenCalled());

    // Keyed to the send it was typed against, so the record lands on that one.
    expect(regenerateAction.mock.calls[0]![0]).toMatchObject({ id: 501, feedback: 'Soften the ask.', contentId: 'send-2' });
  });

  it('says when the last regenerate did not land, and why, instead of quietly showing the old copy', async () => {
    await render(<ReviewSurface run={enrollment(3, { regenerateError: 'NOTHING WAS SAVED. body of send 3: em dash.' })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('regenerate-failed-banner')).toBeVisible();
    await expect.element(page.getByTestId('regenerate-failed-banner')).toHaveTextContent('The last regenerate did not land');
    await expect.element(page.getByTestId('regenerate-failed-banner')).toHaveTextContent('body of send 3: em dash.');
  });

  it('shows the outcome under the ask in a send\'s history when the regenerate failed', async () => {
    await render(
      <ReviewSurface
        run={enrollment(3, { revisions: [
          { contentId: 'send-2', step: 2, version: 1, body: 'Body of send 2.', kind: 'proposed', at: '2026-09-22T10:00:00.000Z' },
          { contentId: 'send-2', step: 2, version: 1, body: 'Body of send 2.', ask: 'take the dashes out', kind: 'failed', failure: 'body of send 3: em dash.', at: '2026-09-22T10:05:00.000Z' },
        ] })}
        crumbs={CRUMBS}
      />,
    );

    await page.getByTestId('tab-item-send-2').click();

    await expect.element(page.getByTestId('history-send-2')).toHaveTextContent('did not land');
    await expect.element(page.getByTestId('history-failure-send-2')).toHaveTextContent('body of send 3: em dash.');
  });

  it('offers Regenerate all under the strip, keyed to no send, and only when there is more than one', async () => {
    regenerateAction.mockClear();
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} />);

    // Not on the bar, which keeps one Regenerate from meaning whichever item its author had in mind.
    expect(page.getByTestId('sticky-action-bar').element().textContent).not.toContain('Regenerate');

    await page.getByRole('textbox', { name: 'Instruction for regenerating all sends' }).fill('Replace every dash with a comma.');
    await page.getByTestId('regenerate-all').click();

    await vi.waitFor(() => expect(regenerateAction).toHaveBeenCalled());

    expect(regenerateAction.mock.calls[0]![0]).toEqual({ id: 501, feedback: 'Replace every dash with a comma.' });
  });

  it('draws no Regenerate all on a card with one send: the send\'s own Regenerate is the whole card', async () => {
    await render(<ReviewSurface run={enrollment(1)} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('regenerate-send-1')).toBeVisible();

    expect(page.getByTestId('regenerate-all-open').query()).toBeNull();
  });

  it('keeps the copy and the instruction box on screen together', async () => {
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} />);

    await page.getByTestId('tab-item-send-2').click();

    // The old layout opened the instruction UNDER the send and pushed the
    // copy off screen — exactly when a reviewer needed to read it while
    // writing the ask. Both boxes have to be laid out at once.
    const copy = page.getByTestId('email-pane-send-2').element().getBoundingClientRect();
    const box = page.getByTestId('regenerate-send-2-open').element().getBoundingClientRect();

    expect(copy.width).toBeGreaterThan(0);
    expect(box.width).toBeGreaterThan(0);
    // Side by side at this width, not stacked.
    expect(box.left).toBeGreaterThanOrEqual(copy.right - 1);
  });

  it('does not carry an instruction typed for one send over to the next', async () => {
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} />);

    await page.getByTestId('tab-item-send-2').click();
    await page.getByRole('textbox', { name: 'Regenerate instruction for Day 3' }).fill('Soften the ask.');
    await page.getByTestId('tab-item-send-3').click();

    await expect.element(page.getByRole('textbox', { name: 'Regenerate instruction for Day 6' })).toHaveValue('');
  });

  it('reads the history of the send it is about, and only that one', async () => {
    await render(
      <ReviewSurface
        run={enrollment(3, {
          revisions: [
            { contentId: 'send-1', version: 1, kind: 'proposed', body: 'First draft.', ask: 'lead with the hiring signal', at: '2026-09-17T10:00:00.000Z', by: 'revenue-lead' },
            { contentId: 'send-1', version: 2, kind: 'regenerated', body: 'Second draft.', at: '2026-09-18T10:00:00.000Z' },
            { contentId: 'send-2', version: 1, kind: 'proposed', body: 'Other send.', ask: 'not this one', at: '2026-09-18T10:00:00.000Z' },
          ],
        })}
        crumbs={CRUMBS}
      />,
    );

    const history = page.getByTestId('history-send-1').element();

    expect(history.textContent).toContain('v1 proposed by revenue-lead');
    expect(history.textContent).toContain('Sep 17');
    expect(history.textContent).toContain('asked “lead with the hiring signal”');
    expect(history.textContent).toContain('v2 regenerated');
    expect(history.textContent).not.toContain('not this one');
  });

  it('holds a regenerating item in place, with the instruction on screen', async () => {
    await render(<ReviewSurface run={enrollment(3, { regeneratingSince: new Date().toISOString(), regenerateNote: 'Shorter.' })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('regenerating-banner')).toBeVisible();
    await expect.element(page.getByTestId('regenerating-banner')).toHaveTextContent('Shorter.');
    // The item is still here, in its own tab, disabled rather than replaced.
    await expect.element(page.getByTestId('item-pane-send-1')).toBeVisible();
    expect(page.getByTestId('decide-approve').element()).toBeDisabled();
  });

  it('holds the primary with a reason reachable from the button', async () => {
    const reason = 'The contact is already in “Q3 Outbound”, and the recommendation does not say whether this replaces it.';
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} hold={{ reason }} />);

    const button = page.getByTestId('decide-approve').element();

    expect(button).toBeDisabled();
    // The reason travels two ways, because a tooltip alone is invisible on touch.
    expect(button.closest('[title]')?.getAttribute('title')).toBe(reason);

    const describedBy = button.getAttribute('aria-describedby')!;

    expect(document.getElementById(describedBy)?.textContent).toBe(reason);
    await expect.element(page.getByTestId('primary-held')).toHaveTextContent(reason);
  });

  it('keeps a failed run decidable, with its error and a Retry primary', async () => {
    await render(<ReviewSurface run={enrollment(3, { status: 'failed', error: 'HubSpot rejected the enrollment.' })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('execution-failed-banner')).toHaveTextContent('HubSpot rejected the enrollment.');
    await expect.element(page.getByTestId('decide-approve')).toHaveTextContent('Retry Confirm');
    expect(page.getByTestId('decide-approve').element()).not.toBeDisabled();
  });

  it('holds the decision bar in place as you move between tabs', async () => {
    await render(<ReviewSurface run={enrollment(6)} crumbs={CRUMBS} />);

    const bar = page.getByTestId('sticky-action-bar').element();
    const first = bar.getBoundingClientRect().top;
    await page.getByTestId('tab-item-send-6').click();
    const onLast = bar.getBoundingClientRect().top;
    await page.getByTestId('tab-item-send-1').click();
    const back = bar.getBoundingClientRect().top;

    expect(Math.round(onLast)).toBe(Math.round(first));
    expect(Math.round(back)).toBe(Math.round(first));
  });

  it('renders a surface tab where the surface asks for one, after the content', async () => {
    await render(
      <ReviewSurface
        run={enrollment(3)}
        crumbs={CRUMBS}
        extraTabs={[{ id: 'brief', label: 'Brief', children: <p>The research brief.</p> }]}
      />,
    );

    const labels = [...page.getByTestId('review-tabs').element().querySelectorAll('[data-slot="tabs-trigger"]')].map(t => t.textContent);

    expect(labels).toEqual(['Day 0', 'Day 3', 'Day 6', 'Brief']);

    await page.getByTestId('tab-extra-brief').click();

    await expect.element(page.getByText('The research brief.')).toBeVisible();
  });

  it('lands a conversation rewrite in the tab it belongs to', async () => {
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} />);

    // Reading send 1 when a rewrite of send 3 arrives from the rail.
    await expect.element(page.getByTestId('item-pane-send-1')).toBeVisible();

    publishDraftRevision({ runId: 501, contentId: 'send-3', body: 'The rail rewrote this one.' });

    await expect.element(page.getByTestId('item-pane-send-3')).toBeVisible();
    await expect.element(page.getByTestId('email-pane-send-3')).toHaveAttribute('data-changed', 'true');
    // The rail publishes prose; the editor shows it as the paragraph it is.
    expect(page.getByTestId('email-pane-send-3').element().querySelector('[contenteditable="true"]')!.textContent).toBe('The rail rewrote this one.');
  });

  it('reads without a bar when there is nothing pending to decide', async () => {
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} decidable={false} />);

    await expect.element(page.getByTestId('review-surface')).toBeVisible();
    expect(page.getByTestId('sticky-action-bar').elements()).toHaveLength(0);
  });
});
