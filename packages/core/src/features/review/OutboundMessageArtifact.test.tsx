/**
 * The outbound message artifact, asserted where it is claimed: a reply draft
 * reads as the email it will be (who, what it answers, the copy, the
 * signature, one short Why), a refused approval reads as a sentence and a
 * fix with the vendor's JSON behind Details, and a sequence keeps its own
 * shape — a step timeline under its enrolment — on the same shell.
 */
import type { ReviewCardRun } from './ReviewSurface';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { Toaster } from '@/components/ui/toast';
import '@/styles/global.css';

const decideAction = vi.fn(async (_input: Record<string, unknown>): Promise<Record<string, unknown>> => ({ execution: null }));
const undoAction = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }));

vi.mock('@/libs/Orpc', () => ({
  client: {
    review: {
      decideAction: (input: Record<string, unknown>) => decideAction(input),
      undoAction: (input: Record<string, unknown>) => undoAction(input),
      snoozeAction: async () => ({ ok: true }),
      regenerateAction: async () => ({ ok: true }),
      approveContent: async () => ({ ok: true, hash: 'x' }),
      unapproveContent: async () => ({ ok: true }),
      actionStatus: async () => ({ regeneratingSince: null, regenerateNote: null }),
    },
  },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/inbox/proposal-8017',
}));

const { ReviewSurface } = await import('./ReviewSurface');

const CRUMBS = [{ label: 'Workspace', href: '/dashboard' }, { label: 'Review', href: '/dashboard/inbox' }, { label: 'Draft a reply to Dana Reyes' }];

const SCOPE_ERROR = 'Gmail draft failed: 403 { "error": { "code": 403, "message": "Request had insufficient authentication scopes.", "status": "PERMISSION_DENIED", "details": [ { "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "metadata": { "service": "gmail.googleapis.com", "method": "caribou.api.proto.MailboxService.CreateDraft" } } ] } }';

function replyDraft(over: Partial<ReviewCardRun> = {}): ReviewCardRun {
  return {
    id: 8017,
    actionId: 'gmail.send',
    status: 'pending',
    invokedBy: 'agent:revenue-lead',
    input: { to: 'Dana Reyes <dana@kestrel.example>', subject: 'Re: Phase 2 priorities', body: 'Dana, Monday works.', draft: true },
    proposal: {
      confidence: 0.8,
      rationale: 'Dana asked on Oct 8 for a joint call before Kestrel\'s Oct 15 board review, and nobody has answered.',
      evidence: ['https://mail.google.com/mail/u/0/#all/t-42'],
      suggestedDecision: 'approve',
      // The title again, as proposal 8017 carried it: never shown twice.
      suggestedDecisionReason: 'Recommended: Draft a reply to Dana Reyes',
    },
    card: {
      title: 'Draft a reply to Dana Reyes',
      object: { title: 'Draft a reply to Dana Reyes', subtitle: 'dana@kestrel.example · Gmail' },
      system: 'Gmail',
      subject: { name: 'Dana Reyes' },
      outbound: {
        channel: 'email',
        mode: 'draft',
        system: 'Gmail',
        to: ['Dana Reyes <dana@kestrel.example>'],
        cc: ['Iris Nakamura <iris@kestrel.example>'],
        recipientsEditable: true,
        contentId: 'message',
        signature: 'Rowan Pike\nNorthwind',
        thread: {
          subject: 'Phase 2 priorities',
          messages: [
            { from: 'Rowan Pike <rowan@northwind.example>', at: '2026-10-06T16:02:00.000Z', snippet: 'Attaching the two Phase 2 options.' },
            { from: 'Iris Nakamura <iris@kestrel.example>', at: '2026-10-07T13:40:00.000Z', snippet: 'Priya and Owen are out until the 20th.' },
            { from: 'Dana Reyes <dana@kestrel.example>', at: '2026-10-08T18:14:00.000Z', snippet: 'Can we get everyone on a call early next week?' },
          ],
        },
        doneLabel: 'Draft created',
        openLabel: 'Open in Gmail',
      },
      content: [{ kind: 'email', id: 'message', label: 'Email', subject: 'Re: Phase 2 priorities', body: 'Dana, Monday works.' }],
      fields: [{ label: 'To', value: 'Dana Reyes <dana@kestrel.example>' }],
      verbs: { approve: 'Create draft in Gmail', reject: 'Reject' },
    },
    ...over,
  };
}

/** What a person sees on the page right now: closed Details are not rendered, so they are not in it. */
// eslint-disable-next-line unicorn/prefer-dom-node-text-content -- innerText is the point: it leaves out a closed <details>, which textContent includes.
const visibleText = () => document.body.innerText;

beforeEach(() => {
  decideAction.mockReset().mockResolvedValue({ execution: null });
  undoAction.mockClear();
});

describe('a reply draft', () => {
  it('reads as the email it will be: title, To and Cc, the thread, the copy, the signature', async () => {
    await render(<ReviewSurface run={replyDraft()} crumbs={CRUMBS} title="Draft a reply to Dana Reyes" />);

    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Draft a reply to Dana Reyes');
    await expect.element(page.getByTestId('recipients-to')).toHaveTextContent('Dana Reyes');
    await expect.element(page.getByTestId('recipients-cc')).toHaveTextContent('Iris Nakamura');
    await expect.element(page.getByTestId('outbound-signature')).toHaveTextContent('Rowan Pike');
    // No jargon: a single email is not "Send 1" of anything, and has no tab strip.
    expect(visibleText()).not.toMatch(/Send 1|SEND 1/);
    expect(document.querySelector('[data-testid="review-tabs"]')).toBeNull();
    await expect.element(page.getByTestId('decide-approve')).toHaveTextContent('Create draft in Gmail');
    await expect.element(page.getByTestId('decide-edit')).toBeVisible();
  });

  it('shows the thread folded to its newest message, the rest one tap away', async () => {
    await render(<ReviewSurface run={replyDraft()} crumbs={CRUMBS} />);

    expect(page.getByTestId('outbound-thread-message').all()).toHaveLength(1);
    await expect.element(page.getByTestId('outbound-thread')).toHaveTextContent('Can we get everyone on a call');

    await page.getByTestId('outbound-thread-toggle').click();

    expect(page.getByTestId('outbound-thread-message').all()).toHaveLength(3);
  });

  it('says Why once, with the evidence, and never the title again', async () => {
    await render(<ReviewSurface run={replyDraft()} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('outbound-why')).toHaveTextContent('nobody has answered');
    expect(visibleText()).not.toMatch(/The reasoning|Why it suggests that/);
    expect(visibleText()).not.toMatch(/Recommended: Draft a reply/);
    await expect.element(page.getByTestId('outbound-why').getByTestId('evidence-refs')).toBeVisible();
  });

  it('hides Why when it would only repeat the title', async () => {
    await render(<ReviewSurface run={replyDraft({ proposal: { rationale: 'Draft a reply to Dana Reyes', suggestedDecision: 'approve', suggestedDecisionReason: 'Recommended: Draft a reply to Dana Reyes' } })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('outbound-composer')).toBeVisible();
    expect(document.querySelector('[data-testid="outbound-why"]')).toBeNull();
  });

  it('takes a recipient change on approve, and says what happened with a link and Undo', async () => {
    decideAction.mockResolvedValue({ execution: { runId: 8017, status: 'done', result: { mode: 'draft', draftId: 'r-1', link: 'https://mail.google.com/mail/#drafts?compose=m-1' } } });
    await render(
      <>
        <ReviewSurface run={replyDraft()} crumbs={CRUMBS} />
        <Toaster />
      </>,
    );

    await page.getByRole('button', { name: 'Remove Iris Nakamura from Cc' }).click();
    await page.getByTestId('decide-approve').click();

    await vi.waitFor(() => expect(decideAction).toHaveBeenCalled());

    expect(decideAction.mock.calls[0]![0]).toMatchObject({ id: 8017, decision: 'approve', contentEdits: [{ id: 'message', cc: '' }] });
    await expect.element(page.getByText('Draft created')).toBeVisible();
    await expect.element(page.getByTestId('toast-link')).toHaveTextContent('Open in Gmail →');
    expect(page.getByTestId('toast-link').element().getAttribute('href')).toBe('https://mail.google.com/mail/#drafts?compose=m-1');

    await page.getByRole('button', { name: 'Undo' }).click();
    await vi.waitFor(() => expect(undoAction).toHaveBeenCalledWith({ id: 8017 }));
  });

  it('e puts the cursor in the copy', async () => {
    await render(<ReviewSurface run={replyDraft()} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('outbound-body')).toBeVisible();

    await userEvent.keyboard('e');

    await vi.waitFor(() => expect(document.querySelector('[data-testid="outbound-body"]')!.contains(document.activeElement)).toBe(true));
  });
});

describe('a refused approval', () => {
  it('reads as a sentence and a fix, with the raw JSON behind Details only', async () => {
    await render(<ReviewSurface run={replyDraft({ status: 'failed', error: SCOPE_ERROR })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('execution-failed-sentence')).toHaveTextContent('Vocion can read this Gmail but isn\'t allowed to create drafts.');

    const fix = page.getByTestId('execution-failed-fix');

    await expect.element(fix).toHaveTextContent('Reconnect Gmail to allow drafts →');

    const href = new URL(fix.element().getAttribute('href')!, 'https://app.example');

    expect(href.pathname).toBe('/api/connect/google/start');
    expect(href.searchParams.get('connector')).toBe('gmail');
    expect(href.searchParams.get('access')).toBe('compose');

    // No raw JSON in the main view.
    expect(visibleText()).not.toMatch(/ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED|"code"|\{ "error"/);
    expect(visibleText()).not.toMatch(/The approval did not go through/);
    // The button says what it does, not "Retry Approve → draft".
    await expect.element(page.getByTestId('decide-approve')).toHaveTextContent('Create draft in Gmail');
    expect(page.getByTestId('decide-approve').element().textContent).not.toMatch(/Retry|→/);

    await page.getByTestId('execution-failed-details').getByText('Details', { exact: true }).click();

    expect(visibleText()).toMatch(/ACCESS_TOKEN_SCOPE_INSUFFICIENT/);
  });

  it('reads any other failure in its own words, with the payload still behind Details', async () => {
    await render(<ReviewSurface run={replyDraft({ status: 'failed', error: 'Gmail send failed: 500 {"error":{"code":500,"message":"Backend Error"}}' })} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('execution-failed-summary')).toHaveTextContent('Gmail send failed (500).');
    expect(visibleText()).not.toMatch(/Backend Error/);
  });
});

describe('a sequence, on the same shell', () => {
  it('shows its enrolment and its steps as a timeline, and queues rather than drafts', async () => {
    const steps = [0, 3, 7].map((day, i) => ({ kind: 'email' as const, id: `send-${i + 1}`, label: `Day ${day}`, tabLabel: `Step ${i + 1} · Day ${day} · email`, subject: `Subject ${i + 1}`, body: `Body ${i + 1}` }));
    await render(
      <ReviewSurface
        crumbs={CRUMBS}
        run={{
          id: 8031,
          actionId: 'personalization.enroll',
          status: 'pending',
          invokedBy: 'agent:revenue-lead',
          input: {},
          proposal: { confidence: 0.6, rationale: 'Downloaded the ebook after the LinkedIn ad.' },
          contentReview: null,
          card: {
            title: 'New MQL ready to enroll',
            subject: { name: 'Rowan Pike' },
            sequence: { name: 'Inbound ebook follow-up', contact: 'Rowan Pike', sender: 'iris@northwind.example', system: 'HubSpot' },
            content: steps,
            fields: [],
            verbs: { approve: 'Queue in HubSpot', reject: 'Decline' },
          },
        }}
      />,
    );

    await expect.element(page.getByTestId('sequence-enrolment')).toHaveTextContent('Inbound ebook follow-up');
    await expect.element(page.getByTestId('sequence-enrolment')).toHaveTextContent('iris@northwind.example');
    await expect.element(page.getByTestId('tab-item-send-2')).toHaveTextContent('Step 2 · Day 3 · email');
    await expect.element(page.getByTestId('tab-item-send-2')).toHaveTextContent('Subject 2');
    expect(document.querySelector('[data-testid="outbound-artifact"]')).toBeNull();
    expect(page.getByTestId('decide-approve').element().textContent).not.toMatch(/draft/i);
  });
});
