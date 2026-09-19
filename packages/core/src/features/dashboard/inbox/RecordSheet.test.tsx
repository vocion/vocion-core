import type { SheetAsk } from './AskSheet';
import type { DecidedProposal, SheetReason } from './RecordSheet';
import type { WorkCardModel } from '@/features/review/reviewSheetModel';
import type { ReviewContextModel } from '@/services/inbox/reviewContextModel';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { __resetToasts, __toasts } from '@/components/ui/toast';
import { workCardModel } from '@/features/review/reviewSheetModel';
import messages from '@/locales/en.json';
import { RecordSheet } from './RecordSheet';

/**
 * The record decision sheet, against the contract Chris asked for on
 * 2026-09-19: the work first and framed, ONE place to act on it that is never
 * below the fold, the note field as the way to approve with direction, the
 * header's context one click behind "Why this?", and a context pane whose rows
 * preview rather than navigate.
 *
 * Plus the contract that came before it and must not regress: deciding never
 * navigates (2026-09-16), and the record's earlier decisions are not the first
 * thing you read (2026-09-17).
 *
 * Fixtures are fictional — Northwind, Kestrel Capital, `.example` addresses.
 */

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/dashboard/inbox/r/hubspot%3Adeals%3A900112',
}));

// next-intl's Link and router need the app-router provider; a stub is enough
// here, and it is what every other preview test mounts.
vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push, replace: () => {} }),
  usePathname: () => '/dashboard/inbox/r/hubspot%3Adeals%3A900112',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

function ask(id: number, title: string, more: Partial<SheetAsk> = {}): SheetAsk {
  return {
    id,
    kind: 'approval',
    kindLabel: 'CRM update',
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
    ...more,
  };
}

const EMAIL_INPUT = { to: 'amy@northwind.example', subject: 'Kestrel + Contoso intros', body: 'Amy,\n\nGreat reconnecting.\n\nChris', draft: true, baseUrl: 'https://gmail.googleapis.com/gmail/v1' };

const emailWork: WorkCardModel = workCardModel({
  actionId: 'gmail.send',
  actionKind: 'Email',
  input: EMAIL_INPUT,
  changes: [],
  email: { to: 'amy@northwind.example', cc: null, subject: 'Kestrel + Contoso intros', body: 'Amy,\n\nGreat reconnecting.\n\nChris', draft: true },
});

const crmWork: WorkCardModel = workCardModel({
  actionId: 'hubspot.update',
  actionKind: 'CRM update',
  input: { objectType: 'deals', objectId: '900112', properties: { closedate: '2026-11-30' }, baseUrl: 'https://api.hubapi.com' },
  changes: [{ field: 'closedate', from: '2026-10-15', to: '2026-11-30' }],
  email: null,
});

const reason: SheetReason = {
  reason: 'Transcript confirms Amy offered two intros as the concrete next step; 115th consecutive check with no human decision.',
  runId: 565,
  since: '2026-09-10T12:00:00.000Z',
  agentSlug: 'revenue-lead',
  confidence: 0.65,
  actionKind: 'Email',
  changes: [{ field: 'subject', to: 'Kestrel + Contoso intros' }],
};

const context: ReviewContextModel = {
  email: 'amy@northwind.example',
  contact: { status: 'ok', data: { hubspotId: '77', name: 'Amy Larkin', email: 'amy@northwind.example', company: 'Northwind Traders', jobTitle: 'VP People', lifecycleStage: 'lead', owner: null, createdAt: '2026-09-01T00:00:00Z', source: 'Offline — import', sourceDetail: null, href: null } },
  touches: { status: 'ok', data: [
    { direction: 'out', subject: 'Following up', snippet: 'Sending the terms over.', at: '2026-09-18T00:00:00Z', source: 'gmail', href: null },
    { direction: 'in', subject: 'Pricing for the Q4 rollout', snippet: 'Could you send the tiers?', at: '2026-09-17T00:00:00Z', source: 'hubspot', href: null },
  ] },
  enrollment: { status: 'error', message: 'missing_scope: sequences-read' },
  warnings: ['Your side wrote to them yesterday — "Following up". Check it before sending again.'],
};

/**
 * A CRM update on the same contact: the pane's Changes group is only ever
 * about a record, so an email — whose "change" is its own subject, already in
 * the composer — deliberately contributes none.
 */
const crmReason: SheetReason = { ...reason, actionKind: 'CRM update', changes: [{ field: 'closedate', from: '2026-10-15', to: '2026-11-30' }] };

const decided: DecidedProposal[] = [
  { id: 900, title: 'Update Northwind renewal — Stage: contract sent', subline: 'Approve', status: 'done', decidedAt: '2026-09-15T10:00:00.000Z' },
];

const CRUMBS = [{ label: 'Review queue', href: '/dashboard/inbox' }, { label: 'Northwind renewal' }];

type More = {
  reasons?: Record<number, SheetReason>;
  works?: Record<number, WorkCardModel>;
  inputs?: Record<number, Record<string, unknown>>;
  contexts?: Record<number, ReviewContextModel>;
};

const sheet = (open: SheetAsk[], more: More = {}) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <RecordSheet open={open} decided={decided} title="Northwind renewal" crumbs={CRUMBS} {...more} />
  </NextIntlClientProvider>
);

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  __resetToasts();
  try {
    window.localStorage.removeItem('vocion.review.whyThis');
  } catch {
    /* a browser with storage blocked simply starts closed */
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

/** The body of the last `fetch` the sheet made. */
function lastBody(): Record<string, unknown> {
  const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls;
  return JSON.parse(calls.at(-1)![1].body);
}

function lastUrl(): string {
  const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls;
  return calls.at(-1)![0];
}

describe('the work comes first, and looks like the thing it is', () => {
  it('renders an email proposal as a composer, framed, above everything that talks about it', async () => {
    render(sheet([ask(565, 'Draft email to amy@northwind.example')], { works: { 565: emailWork }, inputs: { 565: EMAIL_INPUT }, reasons: { 565: reason } }));

    const card = page.getByTestId('review-work-card');

    await expect.element(card).toBeVisible();
    await expect.element(card.getByLabelText('To')).toHaveValue('amy@northwind.example');
    await expect.element(card.getByLabelText('Subject')).toHaveValue('Kestrel + Contoso intros');
    await expect.element(card.getByLabelText('Body')).toHaveValue('Amy,\n\nGreat reconnecting.\n\nChris');
    // The consequence is stated where the work is, not as a confirm dialog.
    await expect.element(card.getByText(/writes a Gmail draft/)).toBeVisible();
    // The payload's plumbing is never the work.
    expect(page.getByText('gmail.googleapis.com').elements()).toHaveLength(0);
  });

  it('renders a CRM update as a field diff — what it says today, and what would be written', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date')], { works: { 1: crmWork } }));

    const card = page.getByTestId('review-work-card');

    await expect.element(card.getByText('Close date')).toBeVisible();
    await expect.element(card.getByText('2026-10-15')).toBeVisible();
    await expect.element(card.getByLabelText('Close date')).toHaveValue('2026-11-30');
  });
});

describe('one interaction place: the sticky bar decides', () => {
  it('carries Approve and Reject itself — no radio row to choose in first', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date')], { works: { 1: crmWork } }));

    await expect.element(page.getByTestId('sticky-action-bar')).toBeVisible();
    await expect.element(page.getByTestId('decide-approve')).toBeVisible();
    await expect.element(page.getByTestId('decide-reject')).toBeVisible();
    expect(page.getByRole('radio').elements()).toHaveLength(0);
    // The queue's keys are legible without asking for them.
    await expect.element(page.getByTestId('decide-legend')).toBeVisible();
  });

  it('approves in one press and stays on the record', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date'), ask(2, 'Update Northwind renewal — Next step')], { works: { 1: crmWork } }));

    await page.getByTestId('decide-approve').click();

    expect(lastUrl()).toBe('/api/v1/reviews/decide');
    expect(lastBody()).toMatchObject({ kind: 'action', id: 1, action: 'approve' });
    await expect.element(page.getByText('Update Northwind renewal — Next step')).toBeVisible();
    await expect.element(page.getByTestId('record-decided')).toBeVisible();
    expect(push).not.toHaveBeenCalled();
    expect(__toasts()[0]?.title).toContain('Approve');
  });

  it('rejects with whatever is in the field, so a reason still travels', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date')], { works: { 1: crmWork } }));

    await page.getByLabelText('Direction for the agent').fill('The renewal slipped a quarter, not a month.');
    await page.getByTestId('decide-reject').click();

    expect(lastBody()).toMatchObject({ action: 'reject', reason: 'The renewal slipped a quarter, not a month.' });
  });
});

describe('the note field is how you approve with direction', () => {
  it('leaves plain Approve / Reject while it is empty', async () => {
    render(sheet([ask(565, 'Draft email to amy@northwind.example', { isEmail: true, draft: true })], { works: { 565: emailWork }, inputs: { 565: EMAIL_INPUT } }));

    await expect.element(page.getByTestId('decide-approve')).toHaveTextContent('Approve → draft');
    expect(page.getByTestId('decide-send-back').elements()).toHaveLength(0);
  });

  it('typing in it makes the primary Approve with changes and offers Send back', async () => {
    render(sheet([ask(565, 'Draft email to amy@northwind.example', { isEmail: true, draft: true })], { works: { 565: emailWork }, inputs: { 565: EMAIL_INPUT } }));

    await page.getByLabelText('Direction for the agent').fill('Shorter, and mention the July 20 call.');

    await expect.element(page.getByTestId('decide-approve')).toHaveTextContent('Approve with changes');
    await expect.element(page.getByTestId('decide-send-back')).toBeVisible();
  });

  it('Approve with changes executes and files the note as feedback', async () => {
    render(sheet([ask(565, 'Draft email to amy@northwind.example', { isEmail: true })], { works: { 565: emailWork }, inputs: { 565: EMAIL_INPUT } }));

    await page.getByLabelText('Direction for the agent').fill('Shorter, and mention the July 20 call.');
    await page.getByTestId('decide-approve').click();

    expect(lastUrl()).toBe('/api/v1/reviews/decide');
    expect(lastBody()).toMatchObject({ action: 'approve', reason: 'Shorter, and mention the July 20 call.' });
  });

  it('Send back returns it to the agent with the note instead of executing', async () => {
    render(sheet([ask(565, 'Draft email to amy@northwind.example', { isEmail: true })], { works: { 565: emailWork }, inputs: { 565: EMAIL_INPUT } }));

    await page.getByLabelText('Direction for the agent').fill('Wrong contact — this should go to the ops lead.');
    await page.getByTestId('decide-send-back').click();

    // The existing triage signal, not a second feedback path. Nothing executed.
    expect(lastUrl()).toBe('/api/v1/reviews/signal');
    expect(lastBody()).toMatchObject({ id: 565, signal: 'rewrite', hint: 'Wrong contact — this should go to the ops lead.' });
    await expect.element(page.getByTestId('ask-receipt')).toBeVisible();
    await expect.element(page.getByText('Sent back with direction')).toBeVisible();
    expect(__toasts()[0]?.title).toContain('Sent back');
    // It is not a decision, so it never joins the decided list.
    expect(page.getByTestId('record-decided').elements()).toHaveLength(0);
  });

  it('an edited work card approves with the edited payload', async () => {
    render(sheet([ask(565, 'Draft email to amy@northwind.example', { isEmail: true })], { works: { 565: emailWork }, inputs: { 565: EMAIL_INPUT } }));

    await page.getByLabelText('Body').fill('Amy — short version.');

    await expect.element(page.getByTestId('decide-approve')).toHaveTextContent('Approve with changes');

    await page.getByTestId('decide-approve').click();

    expect(lastBody().editedInput).toMatchObject({ ...EMAIL_INPUT, body: 'Amy — short version.' });
  });
});

describe('the keyboard clears the queue, and never eats what you type', () => {
  it('approves on `a` and moves on with `j`', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date'), ask(2, 'Update Northwind renewal — Next step')], { works: { 1: crmWork } }));

    await userEvent.keyboard('j');

    await expect.element(page.getByText('Update Northwind renewal — Next step')).toBeVisible();

    await userEvent.keyboard('a');

    expect(lastBody()).toMatchObject({ id: 2, action: 'approve' });
  });

  it('is dead while the note field has focus', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date')], { works: { 1: crmWork } }));

    await page.getByLabelText('Direction for the agent').click();
    await userEvent.keyboard('add a day');

    await expect.element(page.getByLabelText('Direction for the agent')).toHaveValue('add a day');
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});

describe('the header is a line; the rest is one click behind "Why this?"', () => {
  it('folds the reason, the run id, the waiting time and the earlier decisions into one disclosure', async () => {
    render(sheet([ask(565, 'Draft email to amy@northwind.example')], { works: { 565: emailWork }, reasons: { 565: reason } }));

    const toggle = page.getByTestId('review-why-toggle');

    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
    // Closed, none of it is on screen — that is the whole point.
    await expect.element(page.getByTestId('review-why-body')).not.toBeVisible();
    await expect.element(page.getByText(/115th consecutive check/)).not.toBeVisible();

    await toggle.click();

    await expect.element(page.getByText(/115th consecutive check/)).toBeVisible();
    await expect.element(page.getByText('#565')).toBeVisible();
    await expect.element(page.getByText('65%')).toBeVisible();
    // Nothing is deleted: the record's earlier decisions are in the same fold.
    await expect.element(page.getByTestId('record-history')).toBeVisible();
    await expect.element(page.getByText('Update Northwind renewal — Stage: contract sent')).toBeVisible();
  });

  it('remembers per browser that you like it open', async () => {
    window.localStorage.setItem('vocion.review.whyThis', '1');
    render(sheet([ask(565, 'Draft email to amy@northwind.example')], { works: { 565: emailWork }, reasons: { 565: reason } }));

    await expect.element(page.getByTestId('review-why-toggle')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the context pane previews instead of navigating', () => {
  it('lists more than email — the contact, the threads, the sequence, the changes', async () => {
    render(sheet([ask(565, 'Update the Northwind renewal')], { works: { 565: crmWork }, reasons: { 565: crmReason }, contexts: { 565: context } }));

    const rail = page.getByTestId('review-context');

    await expect.element(rail).toBeVisible();
    await expect.element(rail.getByTestId('review-context-row-crm')).toHaveTextContent('Amy Larkin');
    await expect.element(rail.getByTestId('review-context-row-thread:0')).toHaveTextContent('Following up');
    await expect.element(rail.getByTestId('review-context-row-change:0')).toHaveTextContent('Close date');
    // What could not be read says so, in the system's own words.
    await expect.element(page.getByTestId('review-context-notes')).toHaveTextContent('Sequence — Could not read: missing_scope');
    // An email's own subject is not a record change, so the composer is the
    // only place it appears.
    expect(page.getByTestId('review-context-row-change:0').elements()).toHaveLength(1);
    await expect.element(page.getByTestId('review-context-warnings')).toBeVisible();
    await expect.element(page.getByTestId('review-context-ask')).toBeVisible();
  });

  it('opens a row in the pane, with a way back, and never leaves the decision', async () => {
    render(sheet([ask(565, 'Update the Northwind renewal')], { works: { 565: crmWork }, reasons: { 565: crmReason }, contexts: { 565: context } }));

    await page.getByTestId('review-context-row-crm').click();

    const preview = page.getByTestId('review-context-preview');

    await expect.element(preview).toBeVisible();
    await expect.element(preview).toHaveTextContent('VP People');
    expect(push).not.toHaveBeenCalled();
    // The decision is still on screen and still decidable behind the peek.
    await expect.element(page.getByTestId('decide-approve')).toBeVisible();

    await page.getByTestId('preview-close').click();

    await expect.element(page.getByTestId('review-context-row-crm')).toBeVisible();
  });

  it('is searchable once there is enough to search', async () => {
    render(sheet([ask(565, 'Update the Northwind renewal')], { works: { 565: crmWork }, reasons: { 565: crmReason }, contexts: { 565: context } }));

    await page.getByTestId('review-context-search').fill('following');

    await expect.element(page.getByTestId('review-context-row-thread:0')).toBeVisible();
    expect(page.getByTestId('review-context-row-crm').elements()).toHaveLength(0);
  });
});

describe('what must not regress', () => {
  it('offers a named way back only once nothing is left, and never navigates on its own', async () => {
    render(sheet([ask(1, 'Update Northwind renewal — Close date')], { works: { 1: crmWork } }));

    await page.getByTestId('decide-approve').click();

    await expect.element(page.getByText('All decided. Nothing here is waiting on you.')).toBeVisible();
    expect(push).not.toHaveBeenCalled();

    await page.getByTestId('ask-exit').click();

    expect(push).toHaveBeenCalledWith('/dashboard/inbox');
  });

  it('keeps the record\'s own record on screen when there is nothing left to decide', async () => {
    render(sheet([], {}));

    await expect.element(page.getByTestId('record-history')).toBeVisible();
    await expect.element(page.getByText('Update Northwind renewal — Stage: contract sent')).toBeVisible();
  });
});
