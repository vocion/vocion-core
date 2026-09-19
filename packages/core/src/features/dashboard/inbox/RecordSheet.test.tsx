import type { SheetAsk } from './AskSheet';
import type { DecidedProposal, SheetReason } from './RecordSheet';
import type { EmailPreviewModel } from '@/services/inbox/emailPreview';
import type { ReviewContextModel } from '@/services/inbox/reviewContextModel';
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
 * redirected me back to the review queue list with no context. At least give me my
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

const CRUMBS = [{ label: 'Review queue', href: '/dashboard/inbox' }, { label: 'Northwind renewal' }];

const sheet = (open: SheetAsk[], more: { reasons?: Record<number, SheetReason>; emails?: Record<number, EmailPreviewModel>; contexts?: Record<number, ReviewContextModel> } = {}) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <RecordSheet open={open} decided={decided} title="Northwind renewal" crumbs={CRUMBS} {...more} />
  </NextIntlClientProvider>
);

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  __resetToasts();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

describe('deciding on a record sheet', () => {
  it('stays on the record, moves the decided row into Decided, and steps to the next recommendation', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date: 2026-11-30'), ask(2, 'Update Northwind renewal — Next step: Send the terms')]));

    await page.getByRole('radio', { name: /Approve/ }).first().click();
    await page.getByTestId('ask-submit').click();

    // The next open proposal is what you are looking at — still on the record.
    await expect.element(page.getByText('Update Northwind renewal — Next step: Send the terms')).toBeVisible();
    expect(push).not.toHaveBeenCalled();

    // The one just decided shows as its own section — what you did in THIS
    // visit stays on screen, and the record's older decisions stay folded.
    await expect.element(page.getByTestId('record-decided')).toBeVisible();
    await expect.element(page.getByText('just now', { exact: true })).toBeVisible();
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

/**
 * Chris, 2026-09-17: *"i don't want to see historical all decided when
 * clicking into a review decision."*
 */
describe('the record\'s earlier decisions', () => {
  it('stays folded behind one line, so the decision is what you see', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date: 2026-11-30')]));

    await expect.element(page.getByTestId('record-history')).toBeVisible();
    expect(await page.getByTestId('record-history').getByRole('button').element().getAttribute('aria-expanded')).toBe('false');
  });
});

/**
 * Chris, 2026-09-18, on an email proposal: "there's not enough info to tell
 * me if I should approve or not. The email body should be visible." The
 * reading order is why → what is recommended → the email → the choice, with
 * the contact's context beside it, each system honest about what it could
 * not read.
 */
describe('what a reviewer needs to decide an email', () => {
  const reason: SheetReason = { reason: 'Transcript confirms Amy offered two intros as the concrete next step; 115th consecutive check with no human decision.', runId: 565, since: '2026-09-10T12:00:00.000Z', agentSlug: 'revenue-lead' };
  const email: EmailPreviewModel = { to: 'amy@northwind.example', cc: null, subject: 'Kestrel + Contoso intros', body: 'Amy,\n\nGreat reconnecting.\n\nChris', draft: true };
  const context: ReviewContextModel = {
    email: 'amy@northwind.example',
    contact: { status: 'ok', data: { hubspotId: '77', name: 'Amy Larkin', email: 'amy@northwind.example', company: 'Northwind', jobTitle: 'VP People', lifecycleStage: 'lead', owner: null, createdAt: '2026-09-01T00:00:00Z', source: 'Offline — import', sourceDetail: null, href: null } },
    touches: { status: 'not-connected' },
    enrollment: { status: 'error', message: 'missing_scope: sequences-read' },
    warnings: ['Your side wrote to them yesterday — "Following up". Check it before sending again.'],
  };

  it('leads with the reason in full, shows the email as an email, and the payload only as a detail', async () => {
    render(sheet([ask(565, 'Draft email to amy@northwind.example — Kestrel + Contoso intros')], { reasons: { 565: reason }, emails: { 565: email } }));

    await expect.element(page.getByTestId('review-reason')).toBeVisible();
    await expect.element(page.getByText(/115th consecutive check/)).toBeVisible();
    await expect.element(page.getByText('run #565', { exact: false })).toBeVisible();

    const preview = page.getByTestId('email-preview');

    await expect.element(preview).toBeVisible();
    await expect.element(preview.getByText('Kestrel + Contoso intros')).toBeVisible();
    await expect.element(preview.getByText(/Great reconnecting/)).toBeVisible();
    await expect.element(preview.getByText(/writes a Gmail draft/)).toBeVisible();
    expect(page.getByText('"baseUrl"').elements()).toHaveLength(0);
  });

  it('puts the contact, the exchange and the sequence beside the decision, and says what it could not read', async () => {
    render(sheet([ask(565, 'Draft email to amy@northwind.example — Kestrel + Contoso intros')], { contexts: { 565: context } }));

    const rail = page.getByTestId('review-context');

    await expect.element(rail).toBeVisible();
    await expect.element(rail.getByText('Amy Larkin')).toBeVisible();
    await expect.element(rail.getByText('Offline — import')).toBeVisible();
    await expect.element(rail.getByText('Not connected')).toBeVisible();
    await expect.element(rail.getByText(/Could not read: missing_scope/)).toBeVisible();
    await expect.element(page.getByTestId('review-context-warnings').getByText(/Following up/)).toBeVisible();
    await expect.element(page.getByTestId('review-context-ask')).toBeVisible();
  });
});
