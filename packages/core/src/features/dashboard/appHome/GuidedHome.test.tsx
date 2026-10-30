import type { DecisionView } from '@/libs/decisions/decision';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { HomeDecisions } from './HomeDecisions';
import { LaunchTiles } from './LaunchTiles';

const answer = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@/libs/Orpc', () => ({ client: { decisions: { answer } } }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/features/dashboard/chat/decisions/DecisionCard', () => ({
  DecisionCard: ({ onAnswer }: { onAnswer: (a: { kind: 'skip' }) => void }) => <button onClick={() => onAnswer({ kind: 'skip' })}>Explicit decision</button>,
}));

it('keeps a decision preview compact and never answers when merely opened', async () => {
  answer.mockClear();
  const decision: DecisionView = { id: 1, kind: 'approval', question: 'Approve the draft?', options: [], allowOther: true, multiple: false, state: 'open', agentSlug: 'lead', ownerUserId: null, conversationId: null };
  await render(<HomeDecisions decisions={[decision]} agentNames={{ lead: 'Lead' }} labels={{ title: 'Needs you', inChat: 'In chat', openChat: 'Open chat', failed: 'Failed' }} />);

  await expect.element(page.getByTestId('home-decision-preview')).not.toHaveAttribute('open');

  await page.getByText('Approve the draft?', { exact: false }).click();

  await expect.element(page.getByRole('button', { name: 'Explicit decision' })).toBeVisible();
  expect(answer).not.toHaveBeenCalled();

  await page.getByRole('button', { name: 'Explicit decision' }).click();

  await expect.element(page.getByTestId('home-decided')).toHaveTextContent('Skipped');
  expect(answer).toHaveBeenCalledOnce();
});

it('keeps conversation decisions linked to their original context', async () => {
  answer.mockClear();
  const decision: DecisionView = { id: 2, kind: 'question', question: 'Which period?', options: [], allowOther: true, multiple: false, state: 'open', agentSlug: null, ownerUserId: null, conversationId: 42 };
  await render(<HomeDecisions decisions={[decision]} agentNames={{}} labels={{ title: 'Needs you', inChat: 'In chat', openChat: 'Open chat', failed: 'Failed' }} />);

  await expect.element(page.getByRole('link', { name: /Which period/ })).toHaveAttribute('href', '/dashboard/chat?conversation=42');
  expect(answer).not.toHaveBeenCalled();
});

it('emphasizes the authored primary action without changing destinations', async () => {
  await render(<LaunchTiles tiles={[{ icon: 'FileText', first: true, title: 'Prepare a draft', description: 'Choose a client first.', prompt: 'Prepare a draft' }, { icon: 'Check', first: false, title: 'Review drafts', description: 'Open existing drafts.', href: '/dashboard/inbox' }]} tint="peach" labels={{ start: 'Start', open: 'Open', run: 'Run', drop: 'Drop {types}', dropping: 'Uploading', dropFailed: 'Failed' }} />);

  await expect.element(page.getByRole('link', { name: 'Start Prepare a draft' })).toHaveAttribute('href', '/dashboard/chat?new=1&prompt=Prepare%20a%20draft');
  await expect.element(page.getByRole('link', { name: 'Open Review drafts' })).toHaveAttribute('href', '/dashboard/inbox');
});
