import type { ChatMessage } from './types';
import type { Suggestion } from '@/libs/chat/suggestions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { AgentMessage } from './AgentMessage';
import '@/styles/global.css';

/**
 * FOLLOW-UPS UNDER AN ANSWER (founder, 2026-10-09: "Check out chat gpt does
 * up to 3 suggestions. If they are really valuable. And doesn't trap them in
 * cards."): quiet text pills on the latest answer only, each sending its
 * words as the next message; never a Decision card. Fixtures are fictional.
 */

const THREE: Suggestion[] = [
  { label: 'Draft the reply to Dana', prompt: 'Draft the reply to Dana' },
  { label: 'Show who\'s waiting on me', prompt: 'Show who\'s waiting on me' },
  { label: 'Dig deeper →', prompt: 'Dig deeper into this', deeper: true },
];

function answer(suggestions?: Suggestion[], level: 'quick' | 'standard' | 'deep' = 'standard'): ChatMessage {
  return {
    id: 51,
    role: 'assistant',
    content: 'The Contoso Supply quote went out; Dana has not replied.',
    runs: [{ type: 'text', text: 'The Contoso Supply quote went out; Dana has not replied.' }],
    effort: { level, chosenBy: 'auto', elapsedMs: 6000, ceilingHit: null, next: level === 'deep' ? null : level === 'quick' ? 'standard' : 'deep' },
    ...(suggestions ? { suggestions } : {}),
  };
}

afterEach(async () => {
  await page.viewport(1280, 800);
});

describe('follow-up pills', () => {
  it('a turn with none shows none: zero is common and fine', async () => {
    await render(<AgentMessage agentName="Revenue" latest message={answer()} onSuggestion={vi.fn()} onDigDeeper={vi.fn()} />);

    await expect.element(page.getByText('The Contoso Supply quote went out')).toBeVisible();
    expect(page.getByTestId('suggestion-pills').elements()).toHaveLength(0);
  });

  it('a turn with three shows three pills; a tap sends its words as the next message', async () => {
    const onSuggestion = vi.fn();
    await render(<AgentMessage agentName="Revenue" latest message={answer(THREE)} onSuggestion={onSuggestion} onDigDeeper={vi.fn()} />);
    const pills = page.getByTestId('suggestion-pill');

    await expect.element(page.getByTestId('suggestion-pills')).toBeVisible();
    expect(pills.elements()).toHaveLength(3);
    expect(pills.elements().map(e => e.textContent)).toEqual(['Draft the reply to Dana', 'Show who\'s waiting on me', 'Dig deeper']);

    await userEvent.click(pills.first());

    expect(onSuggestion).toHaveBeenCalledWith(THREE[0]);
  });

  it('is a pill, never a Decision card', async () => {
    await render(<AgentMessage agentName="Revenue" latest message={answer(THREE)} onSuggestion={vi.fn()} onDigDeeper={vi.fn()} />);

    await expect.element(page.getByTestId('suggestion-pills')).toBeVisible();
    expect(page.getByTestId('decision-card').elements()).toHaveLength(0);
    expect(page.getByRole('radio').elements()).toHaveLength(0);
    expect(page.getByRole('listbox').elements()).toHaveLength(0);
  });

  it('shows on the latest answer only, and not while it streams', async () => {
    const screen = await render(<AgentMessage agentName="Revenue" message={answer(THREE)} onSuggestion={vi.fn()} onDigDeeper={vi.fn()} />);

    await expect.element(page.getByText('The Contoso Supply quote went out')).toBeVisible();
    expect(page.getByTestId('suggestion-pills').elements()).toHaveLength(0);

    await screen.rerender(<AgentMessage agentName="Revenue" latest streaming message={answer(THREE)} onSuggestion={vi.fn()} onDigDeeper={vi.fn()} />);

    expect(page.getByTestId('suggestion-pills').elements()).toHaveLength(0);
  });

  it('offers "Dig deeper →" only when the turn ran below Deep, and it re-asks one level up', async () => {
    const onDigDeeper = vi.fn();
    const onSuggestion = vi.fn();
    await render(<AgentMessage agentName="Revenue" latest message={answer(THREE, 'quick')} onSuggestion={onSuggestion} onDigDeeper={onDigDeeper} />);

    await userEvent.click(page.getByTestId('suggestion-pill').last());

    expect(onDigDeeper).toHaveBeenCalledWith('standard');
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it('shows no "Dig deeper →" on a turn that ran at Deep', async () => {
    await render(<AgentMessage agentName="Revenue" latest message={answer(THREE, 'deep')} onSuggestion={vi.fn()} onDigDeeper={vi.fn()} />);

    await expect.element(page.getByTestId('suggestion-pills')).toBeVisible();
    expect(page.getByTestId('suggestion-pill').elements()).toHaveLength(2);
    expect(page.getByText('Dig deeper').elements()).toHaveLength(0);
  });

  it('never shows the block itself as words, even in a stored answer', async () => {
    const stored = { ...answer(), content: 'Sent.\n\n<suggest>\nDraft the reply to Dana\n</suggest>', runs: [{ type: 'text' as const, text: 'Sent.\n\n<suggest>\nDraft the reply to Dana\n</suggest>' }] };
    await render(<AgentMessage agentName="Revenue" latest message={stored} onSuggestion={vi.fn()} onDigDeeper={vi.fn()} />);

    await expect.element(page.getByText('Sent.')).toBeVisible();
    expect(page.getByText(/suggest>/).elements()).toHaveLength(0);
  });

  it('on a phone: wraps, 44px targets, Tab reaches a pill and Enter sends it', async () => {
    await page.viewport(390, 844);
    const onSuggestion = vi.fn();
    await render(<AgentMessage agentName="Revenue" latest message={answer(THREE)} onSuggestion={onSuggestion} onDigDeeper={vi.fn()} />);
    const pills = page.getByTestId('suggestion-pill');

    await expect.element(page.getByTestId('suggestion-pills')).toBeVisible();

    for (const el of pills.elements()) {
      const box = el.getBoundingClientRect();

      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.right).toBeLessThanOrEqual(390);
    }

    (pills.elements()[1] as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');

    expect(onSuggestion).toHaveBeenCalledWith(THREE[1]);

    await userEvent.tab();

    expect(document.activeElement).toBe(pills.elements()[2]);
  });
});
