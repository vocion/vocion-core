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
      actionStatus: async () => ({ regeneratingSince: null, regenerateNote: null }),
    },
  },
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const { ReviewSurface } = await import('./ReviewSurface');

const CRUMBS = [{ label: 'Workspace', href: '/dashboard' }, { label: 'Review queue', href: '/dashboard/inbox' }, { label: 'Proposals' }];

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

  it.each([3, 4, 5, 6])('turns n=%s content items into n tabs, plus Why and Evidence last', async (n) => {
    await render(<ReviewSurface run={enrollment(n)} crumbs={CRUMBS} />);

    const tabs = page.getByTestId('review-tabs').element().querySelectorAll('[data-slot="tabs-trigger"]');
    const labels = [...tabs].map(t => t.textContent);

    expect(labels).toEqual([...Array.from({ length: n }, (_, i) => `Day ${i * 3}`), 'Why', 'Evidence']);
    expect(labels.at(-1)).toBe('Evidence');
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

    expect(labels).toEqual(['Changes', 'Why', 'Evidence']);
    await expect.element(page.getByTestId('changes-pane')).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'notes' })).toBeVisible();
  });

  it('builds Why and Evidence from the run even when the presenter says nothing', async () => {
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

    const labels = [...page.getByTestId('review-tabs').element().querySelectorAll('[data-slot="tabs-trigger"]')].map(t => t.textContent);

    expect(labels).toEqual(['Why', 'Evidence']);
    await expect.element(page.getByText('No rationale recorded for this proposal.')).toBeVisible();

    await page.getByTestId('tab-evidence').click();

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

    expect(labels).toEqual(['add_feedback', 'Decline', 'Snooze', 'Confirm']);
    expect(bar.textContent).not.toContain('Save for later');
    expect(bar.textContent).not.toContain('Skip');
  });

  it('decides from the keyboard, and never while you are typing', async () => {
    decideAction.mockClear();
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} />);

    await page.getByTestId('email-pane-send-1').element().querySelector('textarea')!.focus();
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
    const body = page.getByTestId('email-pane-send-3').element().querySelector('textarea')!;
    await page.getByTestId('tab-item-send-1').click();
    await page.getByTestId('tab-item-send-3').click();
    const live = page.getByTestId('email-pane-send-3').element().querySelector('textarea')!;
    await page.elementLocator(live).fill('Rewritten in the tab.');

    await page.getByTestId('decide-approve').click();
    await vi.waitFor(() => expect(decideAction).toHaveBeenCalled());

    expect(body).toBeTruthy();
    expect(decideAction.mock.calls[0]![0]).toMatchObject({
      decision: 'approve',
      contentEdits: [{ id: 'send-3', body: 'Rewritten in the tab.' }],
    });
  });

  it('puts Regenerate beside the item and names it', async () => {
    regenerateAction.mockClear();
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} />);

    await page.getByTestId('tab-item-send-2').click();

    await expect.element(page.getByTestId('regenerate-send-2')).toHaveTextContent('Regenerate Day 3');
    // Not on the bar: one Regenerate there means whichever item its author had in mind.
    expect(page.getByTestId('sticky-action-bar').element().textContent).not.toContain('Regenerate');

    await page.getByTestId('regenerate-send-2').click();
    await page.getByRole('textbox', { name: 'Regenerate instruction for Day 3' }).fill('Soften the ask.');
    await page.getByTestId('regenerate-send-2-submit').click();

    await vi.waitFor(() => expect(regenerateAction).toHaveBeenCalled());

    expect(regenerateAction.mock.calls[0]![0]).toMatchObject({ id: 501, feedback: 'Soften the ask.' });
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
    await page.getByTestId('tab-evidence').click();
    const onEvidence = bar.getBoundingClientRect().top;
    await page.getByTestId('tab-item-send-1').click();
    const back = bar.getBoundingClientRect().top;

    expect(Math.round(onEvidence)).toBe(Math.round(first));
    expect(Math.round(back)).toBe(Math.round(first));
  });

  it('renders a surface tab where the surface asks for one, with Evidence still last', async () => {
    await render(
      <ReviewSurface
        run={enrollment(3)}
        crumbs={CRUMBS}
        extraTabs={[{ id: 'brief', label: 'Brief', children: <p>The research brief.</p> }]}
      />,
    );

    const labels = [...page.getByTestId('review-tabs').element().querySelectorAll('[data-slot="tabs-trigger"]')].map(t => t.textContent);

    expect(labels).toEqual(['Day 0', 'Day 3', 'Day 6', 'Brief', 'Why', 'Evidence']);

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
    expect(page.getByTestId('email-pane-send-3').element().querySelector('textarea')!.value).toBe('The rail rewrote this one.');
  });

  it('reads without a bar when there is nothing pending to decide', async () => {
    await render(<ReviewSurface run={enrollment(3)} crumbs={CRUMBS} decidable={false} />);

    await expect.element(page.getByTestId('review-surface')).toBeVisible();
    expect(page.getByTestId('sticky-action-bar').elements()).toHaveLength(0);
  });
});
