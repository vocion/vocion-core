import type { RecommendedAction } from './types';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

vi.mock('@/libs/Orpc', () => ({
  client: { review: { propose: vi.fn(), actionStatus: vi.fn(), snoozeAction: vi.fn(), decideAction: vi.fn(), undoAction: vi.fn() } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const { CardAnswerProvider, CardDecisionProvider } = await import('./cards/CardDecisions');
const { RecommendedActionStack } = await import('./RecommendedActionStack');

const choice: RecommendedAction = {
  id: 'card_c',
  kind: 'choice',
  actionId: '',
  input: {},
  label: 'Which repo first?',
  options: [{ id: 'A', label: 'northwind/portal' }, { id: 'B', label: 'northwind/api' }],
  state: 'proposed',
};

describe('a choice card in the stack', () => {
  it('draws the choice card, not the Approve card, and sends the pick and the skip to the session', async () => {
    const answer = vi.fn();
    const decide = vi.fn();
    await render(
      <CardDecisionProvider value={decide}>
        <CardAnswerProvider value={{ answer, busy: false }}>
          <RecommendedActionStack recs={[choice]} />
        </CardAnswerProvider>
      </CardDecisionProvider>,
    );

    expect(page.getByRole('button', { name: 'Approve' }).elements()).toHaveLength(0);

    await page.getByRole('button', { name: 'B northwind/api' }).click();

    expect(answer).toHaveBeenCalledExactlyOnceWith({ cardId: 'card_c', optionId: 'B', text: 'northwind/api' });
  });

  it('Skip records a dismiss of that card', async () => {
    const decide = vi.fn();
    await render(
      <CardDecisionProvider value={decide}>
        <CardAnswerProvider value={{ answer: vi.fn(), busy: false }}>
          <RecommendedActionStack recs={[choice]} />
        </CardAnswerProvider>
      </CardDecisionProvider>,
    );

    await page.getByRole('button', { name: 'Skip' }).click();

    expect(decide).toHaveBeenCalledExactlyOnceWith({ cardId: 'card_c', label: 'Which repo first?', action: 'dismiss' });
  });

  it('with no provider (an artifact view) the card is read-only and never latches', async () => {
    await render(<RecommendedActionStack recs={[choice]} />);

    await expect.element(page.getByText('B. northwind/api')).toBeVisible();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });
});
