import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import '@/styles/global.css';

/**
 * THE DECISION CARD, BY KEYBOARD (the founder's requirement): number keys
 * pick, arrows move, Enter submits — on a fresh card, the recommendation —
 * Tab reaches "Something else", Esc folds it away, and every answer leaves as
 * a typed `DecisionAnswer`, never text. Fixtures are fictional (Northwind).
 */

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
    await expect.element(page.getByTestId('decision-key-hints')).toHaveTextContent('↑↓ move · 1–3 pick · ↵ submit · Tab something else · Esc fold');
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
  it('shows one card at a time with "1 of 3", and folds to "3 decisions waiting"', async () => {
    const onAnswer = vi.fn();
    await render(<DecisionDock decisions={[repo, { ...repo, id: 42, question: 'Ship it behind a flag?' }, { ...repo, id: 43, question: 'Rename the board?' }]} onAnswer={onAnswer} agentName={() => 'Product manager'} />);

    await expect.element(page.getByTestId('decision-queue')).toHaveTextContent('1 of 3');
    expect(page.getByTestId('decision-card').elements()).toHaveLength(1);

    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByRole('button', { name: /3 decisions waiting/ })).toBeInTheDocument();

    await page.getByRole('button', { name: /3 decisions waiting/ }).click();

    await expect.element(page.getByRole('dialog')).toBeInTheDocument();

    await page.getByTestId('decision-submit').click();

    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ id: 41 }), { kind: 'option', optionIds: ['api'] });
  });

  it('draws nothing when nothing waits', async () => {
    await render(<DecisionDock decisions={[]} onAnswer={vi.fn()} />);

    expect(document.querySelector('[data-testid="decision-dock"]')).toBeNull();
  });
});
