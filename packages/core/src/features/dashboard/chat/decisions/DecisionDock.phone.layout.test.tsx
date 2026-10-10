import type { DecisionView } from '@/libs/decisions/decision';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * THE DOCK ON A PHONE, in a real browser, from the founder's run on 2026-10-09
 * (an iPhone, "setup my software factory"): "I am confused with two prompts in
 * different areas with diff load in and scroll behavior."
 *
 * What he saw, and what is asserted here instead:
 * - A tracker review filed from no conversation docked 400ms after he sent.
 *   What waits elsewhere is a quiet chip, never a card on its own, and never
 *   while a turn runs; the person taps it to answer those here.
 * - The docked card was taller than its slot: Reject, Something else, Skip and
 *   Submit sat below a scroll inside the slot. The question and the buttons
 *   stay in view now, at 390×844, with a keyboard up (390×508) and on its
 *   side (844×390), where the composer itself had been pushed off the screen.
 * - A new card opened scrolled to where the last one was left.
 * - Every control was 30–32px tall: 44px on a phone now.
 *
 * Fixtures are fictional (Northwind).
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
}));
vi.mock('@/features/preview/previewState', () => ({ openPreview: vi.fn() }));
vi.mock('@/libs/Orpc', () => ({ client: { connectSystems: { plan: vi.fn(async () => ({ candidates: [], connected: [], question: null, scope: null, refused: null })) } } }));

const { decisionBlock } = await import('./DecisionDock');
const { DOCK_PHONE_MAX_HEIGHT_VH } = await import('./DecisionCard');
const { ChatComposer } = await import('../ChatComposer');

const review: DecisionView = {
  id: 7,
  kind: 'approval',
  question: 'Review NW-142: approve the login-timeout fix for release?',
  body: 'Filed from the tracker. The fix raises the session timeout from 15 to 30 minutes on the Northwind portal.',
  options: [{ id: 'approve', label: 'Approve', recommended: true }, { id: 'reject', label: 'Reject' }],
  allowOther: true,
  multiple: false,
  state: 'open',
  agentSlug: null,
  ownerUserId: null,
  conversationId: null,
  deadline: { at: new Date(Date.now() + 24 * 3_600_000).toISOString(), defaultLabel: 'Approve' },
};

const connectGitHub: DecisionView = {
  id: 12,
  kind: 'setup',
  question: 'Connect GitHub',
  body: 'The factory reads pull requests, checks and deploy runs on the repositories you grant. You named it · Software Factory needs it.',
  options: [
    { id: 'connect:github', label: 'Connect GitHub', consequence: 'Opens the sign-in, then brings you back here.', recommended: true, href: '/api/connect/github/start' },
    { id: 'paste:github', label: 'Paste a token', consequence: 'Opens the token form, then brings you back here.', href: '/dashboard/connectors?add=github' },
    { id: 'later', label: 'Later', consequence: 'Come back to it at the end' },
  ],
  allowOther: true,
  multiple: false,
  state: 'open',
  agentSlug: 'lead',
  ownerUserId: 'usr-dana',
  conversationId: 1,
};

type Session = Parameters<typeof decisionBlock>[0];

function session(over: Partial<Session> = {}): Session {
  return {
    openDecisions: [],
    waitingDecisions: [review],
    dockNotice: null,
    dismissDockNotice: () => {},
    answerDecision: () => {},
    answeringDecisionId: null,
    decisionError: null,
    agentNameOf: slug => (slug ? 'Workspace lead' : null),
    conversationId: 1,
    sendMessage: () => {},
    messages: [{ role: 'user' }],
    isStreaming: false,
    ...over,
  };
}

/**
 * A phone: the thread scrolls, the Decision is its latest item, the composer below it.
 * @param root0
 * @param root0.s
 * @param root0.height
 */
function Phone({ s, height = 844 }: { s: Session; height?: number }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <div style={{ height }} className="flex flex-col" data-testid="phone-screen">
        <div className="min-h-0 flex-1 overflow-y-auto px-4" data-testid="thread">
          <p style={{ height: 900 }}>The conversation so far.</p>
          {decisionBlock(s).node}
        </div>
        <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} />
      </div>
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('what waits elsewhere, mid-conversation', () => {
  it('never docks the moment the person sends, nor while the turn runs', async () => {
    await page.viewport(390, 844);
    await render(<Phone s={session({ isStreaming: true })} />);

    expect(page.getByTestId('decision-card').elements()).toHaveLength(0);
    expect(page.getByTestId('waiting-nudge').elements()).toHaveLength(0);
  });

  it('is one quiet chip once the turn lands, and opens Review — never a card docked by a tap', async () => {
    await page.viewport(390, 844);
    await render(<Phone s={session()} />);

    expect(page.getByTestId('decision-card').elements()).toHaveLength(0);
    await expect.element(page.getByTestId('waiting-nudge')).toHaveTextContent('1 thing waiting on you');
    await expect.element(page.getByRole('link', { name: /1 thing waiting on you/ })).toHaveAttribute('href', '/dashboard/inbox');
    expect(page.getByTestId('waiting-nudge-open').elements()).toHaveLength(0);
  });

  it('stays out of the dock while the conversation\'s own Decision is there', async () => {
    await page.viewport(390, 844);
    await render(<Phone s={session({ openDecisions: [connectGitHub] })} />);

    expect(page.getByTestId('decision-card').elements()).toHaveLength(1);
    await expect.element(page.getByRole('heading', { name: 'Connect GitHub' })).toBeVisible();
    // Not "1 of 2": the queue is this conversation's own.
    expect(page.getByTestId('decision-queue').elements()).toHaveLength(0);
    expect(page.getByTestId('waiting-nudge').elements()).toHaveLength(0);
  });
});

/**
 * A phone walk, 2026-10-10: the docked card covered the whole screen and hid
 * the agent's turns after every Skip. On a phone it is at most 40% of the
 * screen now, the why and the payload fold behind "Details", and the choices
 * and Submit stay on the card. The thread above it stays in view.
 */
describe('a Decision in the thread', () => {
  for (const [label, w, h] of [['a phone', 390, 844], ['a phone with the keyboard up', 390, 508], ['a phone on its side', 844, 390]] as const) {
    it(`is at most 40% of the screen, with Submit on it, on ${label}`, async () => {
      await page.viewport(w, h);
      await render(<Phone s={session({ openDecisions: [connectGitHub] })} height={h} />);

      const card = await page.getByTestId('decision-card').element() as HTMLElement;
      const box = card.getBoundingClientRect();

      expect(box.height).toBeLessThanOrEqual(h * DOCK_PHONE_MAX_HEIGHT_VH / 100 + 1);

      // The buttons are pinned to the card, never scrolled out of it.
      const foot = (await page.getByTestId('decision-foot').element() as HTMLElement).getBoundingClientRect();

      expect(foot.bottom).toBeLessThanOrEqual(box.bottom + 1);
      expect(foot.top).toBeGreaterThanOrEqual(box.top - 1);
      await expect.element(page.getByTestId('decision-submit')).toBeVisible();
      await expect.element(page.getByTestId('decision-option-connect:github')).toBeInTheDocument();
    });
  }

  it('folds the why behind Details on a phone, and a tap opens it', async () => {
    await page.viewport(390, 844);
    await render(<Phone s={session({ openDecisions: [connectGitHub] })} />);

    await expect.element(page.getByTestId('decision-why')).not.toBeVisible();

    await page.getByTestId('decision-details-toggle').click();

    await expect.element(page.getByText(/The factory reads pull requests/)).toBeVisible();
  });

  it('leaves the conversation above it in view', async () => {
    await page.viewport(390, 844);
    await render(<Phone s={session({ openDecisions: [connectGitHub] })} />);

    const thread = (await page.getByTestId('thread').element() as HTMLElement).getBoundingClientRect();
    const card = (await page.getByTestId('decision-card').element() as HTMLElement).getBoundingClientRect();

    expect(thread.height - card.height).toBeGreaterThan(thread.height * 0.4);
  });

  it('keeps 1/2/3 picking on a phone', async () => {
    await page.viewport(390, 844);
    await render(<Phone s={session({ openDecisions: [connectGitHub] })} />);

    (await page.getByTestId('decision-options').element() as HTMLElement).focus();
    await userEvent.keyboard('3');

    await expect.element(page.getByTestId('decision-option-later')).toHaveAttribute('aria-selected', 'true');
  });

  it('gives every control a thumb\'s 44px on a phone', async () => {
    await page.viewport(390, 844);
    await render(<Phone s={session({ openDecisions: [connectGitHub] })} />);

    const card = await page.getByTestId('decision-card').element() as HTMLElement;
    const small = [...card.querySelectorAll<HTMLElement>('button, input, [role=option]')]
      .map(el => ({ el: el.dataset.testid ?? el.getAttribute('aria-label') ?? el.textContent, h: el.getBoundingClientRect().height }))
      .filter(t => t.h < 44);

    expect(small).toEqual([]);
  });
});
