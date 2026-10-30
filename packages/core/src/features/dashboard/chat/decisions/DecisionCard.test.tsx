import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { decisionKey } from '@/libs/decisions/decision';
import '@/styles/global.css';

/**
 * THE DECISION CARD, BY KEYBOARD (the founder's requirement): number keys
 * pick, arrows move, Enter submits — on a fresh card, the recommendation —
 * Tab reaches "Something else", Esc folds it away, and every answer leaves as
 * a typed `DecisionAnswer`, never text. Fixtures are fictional (Northwind).
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));
const openPreview = vi.fn();
vi.mock('@/features/preview/previewState', () => ({ openPreview: (...a: unknown[]) => openPreview(...a) }));

const { DecisionCard } = await import('./DecisionCard');
const { DecisionDock } = await import('./DecisionDock');

const repo: DecisionView = {
  id: 41,
  kind: 'choice',
  question: 'Which repo should the factory build in?',
  body: 'Two repos match "Northwind".',
  options: [
    { id: 'api', label: 'Northwind API', consequence: 'Builds land in the API; CI runs on every push.', recommended: true },
    { id: 'portal', label: 'Northwind Portal', consequence: 'Builds land in the customer portal.' },
    { id: 'docs', label: 'Northwind Docs', consequence: 'Builds land in the docs site.' },
  ],
  allowOther: true,
  multiple: false,
  state: 'open',
  agentSlug: 'product-manager',
  ownerUserId: 'usr-dana',
  conversationId: 392,
};

async function renderCard(over: Partial<DecisionView> = {}, props: Partial<Parameters<typeof DecisionCard>[0]> = {}) {
  const answers: DecisionAnswer[] = [];
  const onAnswer = vi.fn((a: DecisionAnswer) => answers.push(a));
  const onCollapsedChange = vi.fn();
  const screen = await render(<DecisionCard decision={{ ...repo, ...over }} agentName="Product manager" onAnswer={onAnswer} onCollapsedChange={onCollapsedChange} {...props} />);
  return { answers, onAnswer, onCollapsedChange, screen };
}

describe('the docked Decision card', () => {
  it('is a dialog with a listbox: the question, the recommendation first and preselected, each option\'s consequence, visible key hints', async () => {
    await renderCard();

    await expect.element(page.getByRole('dialog', { name: 'Which repo should the factory build in?' })).toBeInTheDocument();

    const options = page.getByRole('option').elements();

    expect(options.map(o => o.textContent)).toEqual([
      '1Northwind APIRecommendedBuilds land in the API; CI runs on every push.',
      '2Northwind PortalBuilds land in the customer portal.',
      '3Northwind DocsBuilds land in the docs site.',
    ]);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    await expect.element(page.getByTestId('decision-key-hints')).toHaveTextContent('↑↓ move · 1–3 pick · ↵ submit · Esc fold · Tab something else');
    await expect.element(page.getByText('Product manager asks', { exact: true })).toBeInTheDocument();
  });

  it('takes focus when it docks, so Enter alone accepts the recommendation', async () => {
    const { answers } = await renderCard();

    await expect.element(page.getByRole('listbox')).toHaveFocus();

    await userEvent.keyboard('{Enter}');

    expect(answers).toEqual([{ kind: 'option', optionIds: ['api'] }]);
  });

  it('a number key picks, Enter submits it', async () => {
    const { answers } = await renderCard();
    await userEvent.keyboard('2');

    expect(page.getByRole('option').elements()[1]!.getAttribute('aria-selected')).toBe('true');

    await userEvent.keyboard('{Enter}');

    expect(answers).toEqual([{ kind: 'option', optionIds: ['portal'] }]);
  });

  it('arrows move the choice; ⌘↵ submits it too', async () => {
    const { answers } = await renderCard();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');

    expect(page.getByRole('option').elements()[2]!.getAttribute('aria-selected')).toBe('true');

    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');

    expect(answers).toEqual([{ kind: 'option', optionIds: ['portal'] }]);
  });

  it('Tab reaches "Something else"; Enter there sends their own words', async () => {
    const { answers } = await renderCard();
    await userEvent.keyboard('{Tab}');

    await expect.element(page.getByTestId('decision-other')).toHaveFocus();

    await userEvent.keyboard('Neither — the Kestrel Capital fork{Enter}');

    expect(answers).toEqual([{ kind: 'free_text', text: 'Neither — the Kestrel Capital fork' }]);
  });

  it('typing a letter on the list starts an answer in their own words', async () => {
    const { answers } = await renderCard();
    await userEvent.keyboard('use main{Enter}');

    expect(answers).toEqual([{ kind: 'free_text', text: 'use main' }]);
  });

  it('the number after the last option is "Something else"', async () => {
    await renderCard();
    await userEvent.keyboard('4');

    await expect.element(page.getByTestId('decision-other')).toHaveFocus();
  });

  it('Esc folds it away and answers nothing', async () => {
    const { answers, onCollapsedChange } = await renderCard();
    await userEvent.keyboard('{Escape}');

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(answers).toEqual([]);
  });

  it('Skip is an answer: the asker carries on without one', async () => {
    const { answers } = await renderCard();
    await page.getByTestId('decision-skip').click();

    expect(answers).toEqual([{ kind: 'skip' }]);
  });

  it('on a Decision that takes several, numbers toggle and Enter sends them in the card\'s order', async () => {
    const { answers } = await renderCard({ multiple: true, options: repo.options.map(o => ({ ...o, recommended: false })) });

    expect(page.getByRole('listbox').element().getAttribute('aria-multiselectable')).toBe('true');

    await userEvent.keyboard('3');
    await userEvent.keyboard('1');
    await userEvent.keyboard('{Enter}');

    expect(answers).toEqual([{ kind: 'option', optionIds: ['api', 'docs'] }]);
  });

  it('a question with no options is answered in words, focused in the box', async () => {
    const { answers } = await renderCard({ kind: 'question', question: 'What should the export be called?', options: [] });

    await expect.element(page.getByTestId('decision-other')).toHaveFocus();

    await userEvent.keyboard('Viewer list{Enter}');

    expect(answers).toEqual([{ kind: 'free_text', text: 'Viewer list' }]);
  });

  it('never takes focus from words the person is typing elsewhere', async () => {
    const box = document.createElement('textarea');
    box.value = 'half a sentence';
    document.body.append(box);
    box.focus();
    await renderCard();

    expect(document.activeElement).toBe(box);

    box.remove();
  });

  it('says once, for a screen reader, what arrived and how to answer it', async () => {
    await renderCard();

    await expect.element(page.getByRole('status')).toHaveTextContent('Product manager asks: Which repo should the factory build in?. 3 options, the recommended one first. Press a number to pick and Enter to submit.');
  });

  it('answers nothing while busy, and shows why the last answer did not land', async () => {
    const { answers } = await renderCard({}, { busy: true, error: 'Decision 41 was already answered' });
    await userEvent.keyboard('{Enter}');

    expect(answers).toEqual([]);
    await expect.element(page.getByRole('alert')).toHaveTextContent('Decision 41 was already answered');
  });
});

describe('the dock', () => {
  it('folds several asks into one row, "N asks · Review", never N cards', async () => {
    const asks = Array.from({ length: 8 }, (_, i) => ({ ...repo, id: 100 + i, question: `Draft the note to contact ${i + 1}?` }));
    await render(<DecisionDock decisions={asks} onAnswer={vi.fn()} agentName={() => 'Product manager'} />);

    await expect.element(page.getByTestId('decision-asks-row')).toHaveTextContent(/8 asks ·.*Review/);
    expect(page.getByTestId('decision-card').elements()).toHaveLength(0);

    await page.getByTestId('decision-asks-row').click();

    expect(page.getByTestId('decision-card').elements()).toHaveLength(1);
    await expect.element(page.getByTestId('decision-queue')).toHaveTextContent('1 of 8');
  });

  it('shows one card at a time with "1 of 3" once opened, and folds to "3 decisions waiting"', async () => {
    const onAnswer = vi.fn();
    await render(<DecisionDock decisions={[repo, { ...repo, id: 42, question: 'Ship it behind a flag?' }, { ...repo, id: 43, question: 'Rename the board?' }]} onAnswer={onAnswer} agentName={() => 'Product manager'} />);

    await page.getByTestId('decision-asks-row').click();

    await expect.element(page.getByTestId('decision-queue')).toHaveTextContent('1 of 3');
    expect(page.getByTestId('decision-card').elements()).toHaveLength(1);

    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByRole('button', { name: /3 decisions waiting/ })).toBeInTheDocument();

    await page.getByRole('button', { name: /3 decisions waiting/ }).click();

    await expect.element(page.getByRole('dialog')).toBeInTheDocument();

    await page.getByTestId('decision-submit').click();

    // The newest of the conversation's own leads; the others stay one move away.
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ id: 43 }), { kind: 'option', optionIds: ['api'] });
  });

  it('stays open while the person taps into the composer and types (Chris, 2026-10-23)', async () => {
    await render(
      <div>
        <DecisionDock decisions={[repo]} onAnswer={vi.fn()} agentName={() => 'Product manager'} />
        <textarea data-agent-composer aria-label="Message" />
      </div>,
    );

    await expect.element(page.getByRole('dialog')).toBeInTheDocument();

    await page.getByRole('textbox', { name: 'Message' }).click();
    await userEvent.keyboard('Northwind is fine');

    await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    expect(page.getByTestId('decision-folded').query()).toBeNull();
  });

  it('folds to its own bar once the reply to the person\'s message starts to stream in, and stays folded', async () => {
    const key = new Set([decisionKey(repo)]);
    const screen = await render(<DecisionDock decisions={[repo]} onAnswer={vi.fn()} agentName={() => 'Product manager'} updating={key} />);

    // Sent, still thinking: the card waits ("Updating…") but stays open.
    await expect.element(page.getByRole('dialog')).toBeInTheDocument();

    await screen.rerender(<DecisionDock decisions={[repo]} onAnswer={vi.fn()} agentName={() => 'Product manager'} updating={key} replying />);

    await expect.element(page.getByTestId('decision-folded')).toBeInTheDocument();
    // The same card, folded: its surface, its agent, its "asks" line.
    await expect.element(page.getByTestId('decision-folded-asker')).toHaveTextContent('Product manager asks');
    expect(page.getByTestId('decision-folded').element().className).toContain('bg-card');

    // The turn lands; the fold is the person's to undo.
    await screen.rerender(<DecisionDock decisions={[repo]} onAnswer={vi.fn()} agentName={() => 'Product manager'} />);

    await expect.element(page.getByTestId('decision-folded')).toBeInTheDocument();
  });

  it('a reply streaming in a turn that started without the card folds nothing', async () => {
    const screen = await render(<DecisionDock decisions={[repo]} onAnswer={vi.fn()} agentName={() => 'Product manager'} />);

    await screen.rerender(<DecisionDock decisions={[repo]} onAnswer={vi.fn()} agentName={() => 'Product manager'} replying />);

    await expect.element(page.getByRole('dialog')).toBeInTheDocument();
  });

  it('while a turn may revise it, says "Updating…" and waits; a revision says "Revised" (2026-10-23)', async () => {
    const onAnswer = vi.fn();
    const screen = await render(<DecisionCard decision={repo} agentName="Founder GTM Lead" updating onAnswer={onAnswer} />);

    await expect.element(page.getByTestId('decision-updating')).toHaveTextContent('Updating…');
    expect(page.getByTestId('decision-submit').element().hasAttribute('disabled')).toBe(true);

    await userEvent.keyboard('{Enter}');

    expect(onAnswer).not.toHaveBeenCalled();

    await screen.rerender(<DecisionCard decision={{ ...repo, id: 44, revises: 41, question: 'Which repo, now that the portal is retired?' }} agentName="Founder GTM Lead" onAnswer={onAnswer} />);

    expect(page.getByTestId('decision-updating').elements()).toHaveLength(0);
    await expect.element(page.getByTestId('decision-revised')).toHaveTextContent('Revised');
  });

  it('draws nothing when nothing waits', async () => {
    await render(<DecisionDock decisions={[]} onAnswer={vi.fn()} />);

    expect(document.querySelector('[data-testid="decision-dock"]')).toBeNull();
  });
});

describe('phase two: every kind of Decision on the one card', () => {
  it('a link option OPENS its flow — a login, a token form — and answers nothing', async () => {
    const opened = vi.fn();
    const { answers } = await renderCard({ kind: 'setup', question: 'Connect GitHub', options: [{ id: 'connect:github', label: 'Connect with GitHub', href: '/api/connect/github/start?connector=github', recommended: true }, { id: 'paste:github', label: 'Paste a token', href: '/dashboard/connectors?add=github&paste=1' }] }, { onOpen: opened });

    await expect.element(page.getByTestId('decision-option-opens').first()).toHaveTextContent('Opens ↗');

    await userEvent.keyboard('{Enter}');

    expect(opened).toHaveBeenCalledWith('/api/connect/github/start?connector=github');
    expect(answers).toEqual([]);

    await userEvent.keyboard('2{Enter}');

    expect(opened).toHaveBeenLastCalledWith('/dashboard/connectors?add=github&paste=1');
  });

  it('one action is one tap: a single sign-in option is its own button, with no Submit (2026-10-26)', async () => {
    const opened = vi.fn();
    const { answers } = await renderCard({ kind: 'setup', question: 'Connect Google Ads', options: [{ id: 'connect:google-ads', label: 'Log in with Google', consequence: 'Opens the sign-in, then brings you back here.', href: '/api/connect/google/start?connector=google-ads', recommended: true }], allowOther: true }, { onOpen: opened });

    await expect.element(page.getByTestId('decision-one-tap')).toBeInTheDocument();

    expect(page.getByRole('option').elements()).toHaveLength(0);
    expect(document.querySelector('[data-testid="decision-submit"]')).toBeNull();

    await page.getByRole('button', { name: 'Log in with Google' }).click();

    expect(opened).toHaveBeenCalledWith('/api/connect/google/start?connector=google-ads');
    expect(answers).toEqual([]);
    await expect.element(page.getByTestId('decision-skip')).toBeVisible();
  });

  it('on a phone the option rows never clip, and the scroll region says when there is more below', async () => {
    await page.viewport(390, 844);
    await renderCard({ options: [{ id: 'a', label: 'Northwind API', consequence: 'Builds land in the API, CI runs on every push, previews deploy per branch, and the release notes are drafted for review before anything ships.', recommended: true }, { id: 'b', label: 'Northwind Portal', consequence: 'Builds land in the customer portal.' }] });

    for (const row of page.getByRole('option').elements() as HTMLElement[]) {
      expect(row.scrollHeight).toBeLessThanOrEqual(row.clientHeight + 1);
    }

    // Back to the suite's desktop size: the viewport outlives the test.
    await page.viewport(1440, 900);
  });

  it('a notice above the card wraps on a phone instead of cutting off (2026-10-26)', async () => {
    await page.viewport(390, 844);
    const line = 'Finish signing in on the new tab. This card updates when you\'re done.';
    await render(<DecisionDock decisions={[repo]} onAnswer={vi.fn()} agentName={() => 'Product manager'} notice={{ line }} />);

    const p = await page.getByTestId('decision-notice-line').element() as HTMLElement;

    expect(p.textContent).toBe(line);
    expect(p.scrollWidth).toBeLessThanOrEqual(p.clientWidth + 1);
    expect(getComputedStyle(p).whiteSpace).not.toBe('nowrap');

    await page.viewport(1440, 900);
  });

  it('a proposal links its details one move away', async () => {
    await renderCard({ subject: 'proposal', id: 6061, kind: 'approval', question: 'Move Northwind to Negotiation', href: '/dashboard/inbox/proposal-6061', hrefLabel: 'Details', options: [{ id: 'approve', label: 'Approve', consequence: 'Deal stage → Negotiation — as you, with Undo.', recommended: true }, { id: 'reject', label: 'Reject' }] });

    await expect.element(page.getByTestId('decision-details')).toHaveAttribute('href', '/dashboard/inbox/proposal-6061');
  });

  it('a sign-off opens its artifact in place, and revising is said in their own words', async () => {
    const { answers } = await renderCard({ kind: 'signoff', question: 'Sign off the Northwind proposal v3?', refs: [{ type: 'artifact', id: '77' }], options: [{ id: 'approve', label: 'Approve', recommended: true }, { id: 'reject', label: 'Discard' }] });

    await page.getByTestId('decision-open-artifact').click();

    expect(openPreview).toHaveBeenCalledWith({ type: 'artifact', id: '77' }, expect.anything());
    await expect.element(page.getByTestId('decision-other')).toHaveAttribute('placeholder', 'Revise — say what to change…');

    await page.getByTestId('decision-other').click();
    await userEvent.keyboard('Tighten the pricing page{Enter}');

    expect(answers).toEqual([{ kind: 'free_text', text: 'Tighten the pricing page' }]);
  });

  it('in a conversation under way, what waits elsewhere queues behind its own, says where it waits, and the dock says once what an answer did', async () => {
    const elsewhere = { ...repo, id: 9, question: 'Archive the Q3 board?', conversationId: null };
    await render(<DecisionDock decisions={[repo]} waiting={[repo, elsewhere]} onAnswer={vi.fn()} agentName={() => 'Product manager'} notice={{ line: 'Chose No · Rename the board?', receipt: { runId: 5, actionId: 'objects.rename', label: 'Renamed the board', undoable: true } }} />);

    await page.getByTestId('decision-asks-row').click();

    await expect.element(page.getByRole('dialog', { name: repo.question })).toBeInTheDocument();
    await expect.element(page.getByTestId('decision-queue')).toHaveTextContent('1 of 2');
    await expect.element(page.getByTestId('decision-notice')).toHaveTextContent('Chose No · Rename the board?');
    await expect.element(page.getByTestId('done-receipt-undo-5')).toBeVisible();
  });

  it('what waits elsewhere alone is labelled as such', async () => {
    const elsewhere = { ...repo, id: 9, question: 'Archive the Q3 board?', conversationId: null };
    await render(<DecisionDock decisions={[]} waiting={[elsewhere]} onAnswer={vi.fn()} agentName={() => 'Product manager'} />);

    await expect.element(page.getByText('Waiting on you · Product manager asks', { exact: false }).first()).toBeInTheDocument();
  });
});

const approval: DecisionView = {
  ...repo,
  id: 50,
  subject: 'proposal',
  kind: 'approval',
  question: 'Move Northwind to Negotiation',
  body: 'They signed the LOI on Tuesday.',
  preview: 'deal #4410\ndealstage → negotiation',
  options: [
    { id: 'approve', label: 'Allow once', consequence: 'Runs it as you, this once — with Undo.', recommended: true },
    { id: 'always', label: 'Always allow "update a HubSpot record" in Northwind Support', consequence: 'Runs it now, and moves this kind to Execute within bounds.' },
    { id: 'reject', label: 'Deny', consequence: 'Nothing runs.' },
  ],
};

describe('a step whose effect has a picture', () => {
  it('draws it above the options, from the option that runs it', async () => {
    await renderCard({ kind: 'setup', question: 'Make it yours: Northwind', options: [{ id: 'do', label: 'Use this brand', recommended: true, hasEffect: true, look: { renderer: 'brand', data: { name: 'Northwind', accent: '#1f6feb' } } }, { id: 'adjust', label: 'Adjust', href: '/dashboard/brand' }] });

    await expect.element(page.getByTestId('decision-look')).toHaveAttribute('data-renderer', 'brand');
  });

  it('draws nothing for a renderer this client does not know', async () => {
    await renderCard({ kind: 'setup', question: 'Turn it on', options: [{ id: 'do', label: 'Turn on', recommended: true, look: { renderer: 'not-a-renderer', data: {} } }] });

    expect(page.getByTestId('decision-look').elements()).toHaveLength(0);
  });
});

describe('an approval is a permission prompt', () => {
  it('asks "Allow <agent> to <action>?" over the exact payload, Allow once first, Always allow, Deny — with its keys said', async () => {
    await renderCard(approval, { agentName: 'Revenue lead' });

    await expect.element(page.getByRole('dialog', { name: 'Allow Revenue lead to move Northwind to Negotiation?' })).toBeInTheDocument();
    await expect.element(page.getByTestId('decision-preview')).toHaveTextContent('dealstage → negotiation');
    expect(page.getByRole('option').elements().map(o => o.getAttribute('data-testid'))).toEqual(['decision-option-approve', 'decision-option-always', 'decision-option-reject']);
    await expect.element(page.getByTestId('decision-key-hints')).toHaveTextContent('⌘↵ allow once');
    await expect.element(page.getByTestId('decision-key-hints')).toHaveTextContent('Esc deny');
  });

  it('⌘↵ allows once whatever is highlighted; Esc denies', async () => {
    const { answers, onCollapsedChange } = await renderCard(approval, { agentName: 'Revenue lead' });

    await expect.element(page.getByRole('listbox')).toHaveFocus();

    await userEvent.keyboard('3');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');

    expect(answers).toEqual([{ kind: 'option', optionIds: ['approve'] }]);

    await userEvent.keyboard('{Escape}');

    expect(answers[1]).toEqual({ kind: 'option', optionIds: ['reject'] });
    expect(onCollapsedChange).not.toHaveBeenCalled();
  });

  it('2 then Enter takes Always allow; words half-typed in "Something else" are put down by Esc, never sent as a no', async () => {
    const { answers } = await renderCard(approval, { agentName: 'Revenue lead' });

    await expect.element(page.getByRole('listbox')).toHaveFocus();

    await userEvent.keyboard('w');
    await userEvent.keyboard('ait');
    await userEvent.keyboard('{Escape}');

    expect(answers).toEqual([]);
    await expect.element(page.getByRole('listbox')).toHaveFocus();

    await userEvent.keyboard('2');
    await userEvent.keyboard('{Enter}');

    expect(answers).toEqual([{ kind: 'option', optionIds: ['always'] }]);
  });
});

describe('the asking agent on the card (founder, 2026-10-09)', () => {
  it('heads the card with that agent\'s avatar', async () => {
    await render(<DecisionCard decision={repo} agentName="Dana" agentAccent="violet" onAnswer={() => {}} />);

    await expect.element(page.getByTestId('decision-card')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="decision-card"] [data-slot="agent-dot"]')?.textContent).toBe('D');
  });
});

it('keeps raw payloads collapsed until technical details are requested', async () => {
  await renderCard({ ...approval, preview: '{"tool":"recategorize","input":{"expense_id":"42"}}' }, { agentName: 'Bookkeeper' });

  await expect.element(page.getByTestId('decision-preview')).not.toBeVisible();

  await page.getByText('Technical details', { exact: true }).click();

  await expect.element(page.getByTestId('decision-preview')).toBeVisible();
});

it('shows a domain review title and readable profile without hiding the decision payload', async () => {
  await renderCard({ ...approval, presentation: 'review', question: 'Save the SEO profile: Northwind', preview: 'Goals: Organic leads\nOffering: Accounting services', href: '/dashboard/inbox/proposal-50', hrefLabel: 'Review and edit', options: [{ id: 'approve', label: 'Save the profile', recommended: true }, { id: 'reject', label: 'Do not save' }] });

  await expect.element(page.getByRole('dialog', { name: 'Save the SEO profile: Northwind' })).toBeInTheDocument();
  await expect.element(page.getByTestId('decision-preview')).toBeVisible();
  await expect.element(page.getByTestId('decision-preview')).toHaveTextContent('Accounting services');
  await expect.element(page.getByTestId('decision-option-approve')).toHaveTextContent('Save the profile');
});
