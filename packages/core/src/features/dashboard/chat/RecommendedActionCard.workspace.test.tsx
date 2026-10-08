import type { RecommendedAction } from './types';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import '@/styles/global.css';

/**
 * A CARD FROM ANOTHER WORKSPACE IS DECIDED WHERE IT IS READ.
 *
 * 5.0 screen capture: the person's assistant asked Northwind Revenue, Revenue
 * filed an approval, and the card showed only in Revenue's Review — the
 * personal thread said "it raised a card" and nothing more. The card now comes
 * back into the thread naming the workspace its run lives in, and every call
 * it makes about that run goes there. Fixtures are fictional.
 */

const actionStatus = vi.fn(async (_input: unknown): Promise<Record<string, unknown>> => ({ status: 'pending' }));
const decideAction = vi.fn(async (_input: unknown): Promise<Record<string, unknown>> => ({ ok: true }));
const snoozeAction = vi.fn(async (_input: unknown): Promise<Record<string, unknown>> => ({ ok: true }));
vi.mock('@/libs/Orpc', () => ({
  client: { review: { propose: vi.fn(), actionStatus, snoozeAction, decideAction, undoAction: vi.fn() } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { TooltipProvider } = await import('@/components/ui/tooltip');
const { RecommendedActionCard } = await import('./RecommendedActionCard');

const revenue = { id: 'proj-revenue', slug: 'revenue', name: 'Northwind Revenue', accountSlug: 'northwind' };

/**
 * The card as a thread shows it.
 * @param card - The card.
 * @param locale - The person's language.
 */
function show(card: RecommendedAction, locale: 'en' | 'fr' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      <TooltipProvider><RecommendedActionCard rec={card} /></TooltipProvider>
    </NextIntlClientProvider>,
  );
}
const rec: RecommendedAction = { id: 'card_run41', actionId: 'email.send', input: { to: 'buyer@contoso.example', subject: 'Order form' }, label: 'Send Contoso the order form', agentSlug: 'revenue-lead', runId: 41, state: 'filed', workspace: revenue };

beforeEach(() => {
  actionStatus.mockReset();
  decideAction.mockReset();
  snoozeAction.mockReset();
  actionStatus.mockResolvedValue({ status: 'pending' });
  decideAction.mockResolvedValue({ ok: true });
  snoozeAction.mockResolvedValue({ ok: true });
});

describe('a card whose run lives in another workspace', () => {
  it('reads its status there and approves it there, from this thread', async () => {
    await show(rec);

    await expect.element(page.getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    expect(actionStatus).toHaveBeenCalledWith({ id: 41, workspaceId: 'proj-revenue' });

    await page.getByRole('button', { name: 'Approve' }).click();

    expect(decideAction).toHaveBeenCalledWith({ id: 41, decision: 'approve', workspaceId: 'proj-revenue' });
  });

  it('defers it there', async () => {
    await show(rec);
    await page.getByRole('button', { name: 'Defer' }).click();

    await expect.poll(() => snoozeAction.mock.calls.length).toBe(1);
    expect(snoozeAction.mock.calls[0]?.[0]).toMatchObject({ id: 41, workspaceId: 'proj-revenue' });
  });

  it('says where it lives, and opens it there', async () => {
    await show(rec);
    const open = page.getByRole('link', { name: /Open in Northwind Revenue/ });

    await expect.element(open).toBeInTheDocument();
    await expect.element(open).toHaveAttribute('href', '/w/revenue/dashboard/inbox/proposal-41?account=northwind');
  });

  it('says where it lives in the person\'s language', async () => {
    await show(rec, 'fr');

    await expect.element(page.getByRole('link', { name: /Ouvrir dans Northwind Revenue/ })).toBeInTheDocument();
  });

  it('a card of this workspace calls as it always did', async () => {
    const { workspace: _w, ...here } = rec;
    await show(here);
    await page.getByRole('button', { name: 'Approve' }).click();

    expect(actionStatus).toHaveBeenCalledWith({ id: 41 });
    expect(decideAction).toHaveBeenCalledWith({ id: 41, decision: 'approve' });
    await expect.element(page.getByRole('link', { name: /Decide in review|Open in review/ })).toHaveAttribute('href', '/dashboard/inbox/proposal-41');
  });
});
