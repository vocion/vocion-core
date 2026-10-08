import type { RecommendedAction } from '../types';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * A setup step, pressed once: filed and approved in the same press as the
 * person's decision, Done with Undo once it has run, and nothing said in the
 * conversation on their behalf — the card keeps the run it became.
 */

const actAsPerson = vi.fn(async (): Promise<Record<string, unknown>> => ({ runId: 77, status: 'done' }));
const decideAction = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true }));
const undoAction = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true }));
const actionStatus = vi.fn(async (): Promise<Record<string, unknown>> => ({ status: 'pending' }));
vi.mock('@/libs/Orpc', () => ({
  client: { review: { actAsPerson, decideAction, undoAction, actionStatus } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { SetupCard, SETUP_CHANGED_EVENT } = await import('./SetupCard');
const { CardDecisionProvider } = await import('./CardDecisions');

const rec: RecommendedAction = {
  id: 'card_app1',
  kind: 'setup',
  actionId: 'app.install',
  input: { app: 'software-factory' },
  label: 'Add Software Factory',
  actionLabel: 'Add',
  body: 'Customer requests become fixes the asker hears about.',
  href: '/dashboard/p/products',
  hrefLabel: 'Open Software Factory',
  agentSlug: 'workspace-lead',
  state: 'proposed',
};

beforeEach(() => {
  actAsPerson.mockClear();
  decideAction.mockClear();
  undoAction.mockClear();
  actionStatus.mockReset();
  actionStatus.mockResolvedValue({ status: 'pending' });
});

describe('a setup card', () => {
  it('runs the step as the person\'s decision on one press, then reads Done with Undo and where it lives', async () => {
    const recorded = vi.fn();
    const changed = vi.fn();
    window.addEventListener(SETUP_CHANGED_EVENT, changed);
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CardDecisionProvider value={recorded}>
          <SetupCard rec={rec} />
        </CardDecisionProvider>
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByText('Customer requests become fixes the asker hears about.')).toBeInTheDocument();

    actionStatus.mockResolvedValue({ status: 'done', undoable: true });
    await page.getByRole('button', { name: 'Add' }).click();

    await expect.element(page.getByTestId('setup-card')).toHaveAttribute('data-step-state', 'done');

    // Proposed as the person — their press is the decision — so it ran at once; nothing waits to be approved.
    expect(actAsPerson).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'app.install', input: { app: 'software-factory' }, agentSlug: 'workspace-lead' }));
    expect(decideAction).not.toHaveBeenCalled();
    // Typed, on the card — no turn written in the person's name.
    expect(recorded).toHaveBeenCalledWith({ cardId: 'card_app1', label: 'Add Software Factory', action: 'approve', runId: 77, turn: false });
    await expect.element(page.getByTestId('setup-card-open')).toHaveAttribute('href', '/dashboard/p/products');
    expect(changed).toHaveBeenCalled();

    actionStatus.mockResolvedValue({ status: 'undone' });
    await page.getByTestId('setup-card-undo').click();

    expect(undoAction).toHaveBeenCalledWith({ id: 77 });

    await expect.element(page.getByTestId('setup-card')).toHaveAttribute('data-step-state', 'undone');

    window.removeEventListener(SETUP_CHANGED_EVENT, changed);
  });

  it('a card reloaded with its run shows the run, not the button', async () => {
    actionStatus.mockResolvedValue({ status: 'done', undoable: true });
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SetupCard rec={{ ...rec, runId: 91, state: 'decided' }} />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByTestId('setup-card')).toHaveAttribute('data-step-state', 'done');
    await expect.element(page.getByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(actAsPerson).not.toHaveBeenCalled();
  });

  it('an action that always waits for a person is approved in the same press', async () => {
    actAsPerson.mockResolvedValueOnce({ runId: 78, status: 'pending' });
    actionStatus.mockResolvedValue({ status: 'done', undoable: true });
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SetupCard rec={{ ...rec, id: 'card_wait' }} />
      </NextIntlClientProvider>,
    );
    await page.getByRole('button', { name: 'Add' }).click();

    await expect.element(page.getByTestId('setup-card')).toHaveAttribute('data-step-state', 'done');

    expect(decideAction).toHaveBeenCalledWith({ id: 78, decision: 'approve' });
  });

  it('says so when the step could not run, in words for the person', async () => {
    actAsPerson.mockRejectedValueOnce(new Error('Only an admin can invite people. Ask an admin to accept this card, or to invite them from Members.'));
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SetupCard rec={{ ...rec, id: 'card_inv', actionId: 'members.invite', label: 'Invite ana@northwind.example', actionLabel: 'Invite', input: { emails: ['ana@northwind.example'], role: 'member' } }} />
      </NextIntlClientProvider>,
    );
    await page.getByRole('button', { name: 'Invite' }).click();

    await expect.element(page.getByRole('alert')).toHaveTextContent('Only an admin can invite people');
  });
});
