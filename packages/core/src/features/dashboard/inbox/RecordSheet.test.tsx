import type { SheetAsk } from './AskSheet';
import type { DecidedProposal } from './RecordSheet';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { __resetToasts, __toasts } from '@/components/ui/toast';
import messages from '@/locales/en.json';
import { RecordSheet } from './RecordSheet';

/**
 * Deciding on a record keeps you on the record.
 *
 * Chris, 2026-09-16, after approving one proposal on a record sheet: "It
 * redirected me back to Needs you list with no context. At least give me my
 * toast notification?" The toast was in fact firing and surviving the
 * navigation — what was missing was the record. These tests pin the contract
 * that replaced the redirect: no navigation on submit, the decided row joins
 * the Decided list on the page, the next open proposal becomes current, and
 * the only way out is a button someone presses.
 */

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/dashboard/inbox/r/hubspot%3Adeals%3A900112',
}));

function ask(id: number, title: string): SheetAsk {
  return {
    id,
    kind: 'approval',
    title,
    body: null,
    options: [
      { id: 'approve', label: 'Approve', description: 'Execute this CRM update now.' },
      { id: 'reject', label: 'Reject', description: 'Do not do this.' },
    ],
    contextUrl: null,
    contextMd: null,
    agentSlug: 'revenue-lead',
    teamSlug: null,
    risk: null,
  };
}

const decided: DecidedProposal[] = [
  { id: 900, title: 'Update Northwind renewal — Stage: contract sent', subline: 'Approve', status: 'done', decidedAt: '2026-09-15T10:00:00.000Z' },
];

const CRUMBS = [{ label: 'Needs you', href: '/dashboard/inbox' }, { label: 'Northwind renewal' }];

const sheet = (open: SheetAsk[]) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <RecordSheet open={open} decided={decided} title="Northwind renewal" crumbs={CRUMBS} />
  </NextIntlClientProvider>
);

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  __resetToasts();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

describe('deciding on a record sheet', () => {
  it('stays on the record, moves the decided row into Decided, and steps to the next proposal', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date: 2026-11-30'), ask(2, 'Update Northwind renewal — Next step: Send the terms')]));

    await page.getByRole('radio', { name: /Approve/ }).first().click();
    await page.getByTestId('ask-submit').click();

    // The next open proposal is what you are looking at — still on the record.
    await expect.element(page.getByText('Update Northwind renewal — Next step: Send the terms')).toBeVisible();
    expect(push).not.toHaveBeenCalled();

    // The one just decided joined the list that was already on the page.
    await expect.element(page.getByTestId('record-decided')).toBeVisible();
    await expect.element(page.getByText('just now')).toBeVisible();
    expect(__toasts()[0]?.title).toContain('Approve');
  });

  it('offers a named way back only once nothing is left, and never navigates on its own', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date: 2026-11-30')]));

    await page.getByRole('radio', { name: /Approve/ }).first().click();
    await page.getByTestId('ask-submit').click();

    await expect.element(page.getByText('All decided. Nothing here is waiting on you.')).toBeVisible();
    expect(push).not.toHaveBeenCalled();

    await page.getByTestId('ask-exit').click();

    expect(push).toHaveBeenCalledWith('/dashboard/inbox');
  });
});
