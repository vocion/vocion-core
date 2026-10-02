import type { RecommendedAction } from '../types';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import '@/styles/global.css';

const { ChoiceCard } = await import('./ChoiceCard');

const choice: RecommendedAction = {
  id: 'card_c',
  kind: 'choice',
  actionId: '',
  input: {},
  label: 'What do you want me taking off your plate?',
  body: 'Pick the closest one.',
  options: [
    { id: 'A', label: 'Coding & GitHub', description: 'Pull requests and issues' },
    { id: 'B', label: 'Reports' },
    { id: 'C', label: 'Customer email' },
  ],
  state: 'proposed',
};

describe('a choice card asks one question and takes one answer', () => {
  it('draws lettered buttons named by letter and label, and click B answers with B and its label', async () => {
    const onAnswer = vi.fn();
    await render(<ChoiceCard rec={choice} onAnswer={onAnswer} onDismiss={vi.fn()} />);

    await expect.element(page.getByRole('button', { name: 'A Coding & GitHub' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'C Customer email' })).toBeVisible();
    await expect.element(page.getByText('Pull requests and issues')).toBeVisible();

    await page.getByRole('button', { name: 'B Reports' }).click();

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ cardId: 'card_c', optionId: 'B', text: 'Reports' });
  });

  it('a typed answer goes as option other with the typed text, and send stays off while the field is empty', async () => {
    const onAnswer = vi.fn();
    await render(<ChoiceCard rec={choice} onAnswer={onAnswer} onDismiss={vi.fn()} />);

    const send = page.getByRole('button', { name: 'Send answer' });

    await expect.element(send).toBeDisabled();

    const field = page.getByLabelText('Type your own answer');

    await expect.element(field).not.toHaveAttribute('type', 'password');

    await userEvent.fill(field, 'Ship the portal');

    await expect.element(send).toBeEnabled();

    await send.click();

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ cardId: 'card_c', optionId: 'other', text: 'Ship the portal' });
  });

  it('a card that does not allow your own answer has no text field', async () => {
    await render(<ChoiceCard rec={{ ...choice, allowOther: false }} onAnswer={vi.fn()} onDismiss={vi.fn()} />);

    expect(page.getByLabelText('Type your own answer').elements()).toHaveLength(0);
  });

  it('an answered card collapses to the question and the tick, with no controls', async () => {
    const answered: RecommendedAction = { ...choice, state: 'decided', answer: { optionId: 'A', text: 'Coding & GitHub', at: '2026-10-02T10:00:00.000Z' } };
    await render(<ChoiceCard rec={answered} onAnswer={vi.fn()} onDismiss={vi.fn()} />);

    await expect.element(page.getByText('What do you want me taking off your plate?')).toBeVisible();
    await expect.element(page.getByText('✓ Coding & GitHub')).toBeVisible();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  it('Skip dismisses with the question as its label, and the card then reads Skipped', async () => {
    const onDismiss = vi.fn();
    await render(<ChoiceCard rec={choice} onAnswer={vi.fn()} onDismiss={onDismiss} />);

    await page.getByRole('button', { name: 'Skip' }).click();

    expect(onDismiss).toHaveBeenCalledExactlyOnceWith({ cardId: 'card_c', label: 'What do you want me taking off your plate?' });
    await expect.element(page.getByText('Skipped')).toBeVisible();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  it('a stored deferred card reads Skipped on reload', async () => {
    await render(<ChoiceCard rec={{ ...choice, state: 'deferred' }} onAnswer={vi.fn()} onDismiss={vi.fn()} />);

    await expect.element(page.getByText('Skipped')).toBeVisible();
  });

  it('after one click every option is off, so a second tap cannot double-answer', async () => {
    const onAnswer = vi.fn();
    await render(<ChoiceCard rec={choice} onAnswer={onAnswer} onDismiss={vi.fn()} />);

    await page.getByRole('button', { name: 'A Coding & GitHub' }).click();

    await expect.element(page.getByRole('button', { name: 'B Reports' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'C Customer email' })).toBeDisabled();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('a refused answer shows the server sentence and turns the options back on', async () => {
    const onAnswer = vi.fn();
    const { rerender } = await render(<ChoiceCard rec={choice} onAnswer={onAnswer} onDismiss={vi.fn()} />);
    await page.getByRole('button', { name: 'A Coding & GitHub' }).click();

    await expect.element(page.getByRole('button', { name: 'B Reports' })).toBeDisabled();

    await rerender(<ChoiceCard rec={{ ...choice, answerRefused: { error: 'That is not one of this card\'s options.', at: 1 } }} onAnswer={onAnswer} onDismiss={vi.fn()} />);

    await expect.element(page.getByRole('alert')).toHaveTextContent('That is not one of this card\'s options.');
    await expect.element(page.getByRole('button', { name: 'B Reports' })).toBeEnabled();
  });

  it('while the session is busy every control is off and one line says to wait', async () => {
    await render(<ChoiceCard rec={choice} busy onAnswer={vi.fn()} onDismiss={vi.fn()} />);

    await expect.element(page.getByRole('button', { name: 'A Coding & GitHub' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Send answer' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Skip' })).toBeDisabled();
    await expect.element(page.getByLabelText('Type your own answer')).toBeDisabled();
    await expect.element(page.getByText('Wait for the reply to finish.')).toBeVisible();
  });

  it('turns the options back on when the session stops being busy', async () => {
    const { rerender } = await render(<ChoiceCard rec={choice} busy onAnswer={vi.fn()} onDismiss={vi.fn()} />);
    await rerender(<ChoiceCard rec={choice} busy={false} onAnswer={vi.fn()} onDismiss={vi.fn()} />);

    await expect.element(page.getByRole('button', { name: 'A Coding & GitHub' })).toBeEnabled();
    expect(page.getByText('Wait for the reply to finish.').elements()).toHaveLength(0);
  });

  it.each([
    ['resolves false', () => Promise.resolve(false)],
    ['throws', () => Promise.reject(new Error('network'))],
  ])('a skip that %s reopens the card and says so', async (_name, outcome) => {
    await render(<ChoiceCard rec={choice} onAnswer={vi.fn()} onDismiss={outcome} />);

    await page.getByRole('button', { name: 'Skip' }).click();

    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not skip this question. Try again.');
    await expect.element(page.getByRole('button', { name: 'A Coding & GitHub' })).toBeEnabled();
    await expect.element(page.getByRole('button', { name: 'Skip' })).toBeEnabled();
  });

  it('a skip the server recorded stays Skipped', async () => {
    await render(<ChoiceCard rec={choice} onAnswer={vi.fn()} onDismiss={() => Promise.resolve(true)} />);

    await page.getByRole('button', { name: 'Skip' }).click();

    await expect.element(page.getByText('Skipped')).toBeVisible();
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });
});
