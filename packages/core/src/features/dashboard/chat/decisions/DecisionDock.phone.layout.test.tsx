import type { DecisionView } from '@/libs/decisions/decision';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
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

/**
 * Whether an element is drawn inside the thread's visible window.
 * @param el - The element.
 */
async function inView(el: HTMLElement): Promise<boolean> {
  const thread = (await page.getByTestId('thread').element() as HTMLElement).getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.top >= thread.top - 1 && r.bottom <= thread.bottom + 1;
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
 * Founder, 2026-10-09: "the card was unreadable because the inner scroll
 * content window was so tiny … I'd expect all options on that card to be
 * visible. But that's ok because its interaction with chat scroll is
 * natural." The Decision is the latest item in the thread, full height.
 */
describe('a Decision in the thread', () => {
  for (const [label, w, h] of [['a phone', 390, 844], ['a phone with the keyboard up', 390, 508], ['a phone on its side', 844, 390]] as const) {
    it(`is full height, nothing inside it scrolls, and the thread brings it into view on ${label}`, async () => {
      await page.viewport(w, h);
      await render(<Phone s={session({ openDecisions: [connectGitHub] })} height={h} />);

      const card = await page.getByTestId('decision-card').element() as HTMLElement;
      const thread = await page.getByTestId('thread').element() as HTMLElement;

      // Every option, its consequence and the buttons are drawn — no box clips them.
      for (let el = card as HTMLElement | null; el && el !== thread; el = el.parentElement) {
        expect(['auto', 'scroll']).not.toContain(getComputedStyle(el).overflowY);
      }

      expect(card.scrollHeight).toBeLessThanOrEqual(card.clientHeight + 1);
      await expect.element(page.getByText('Opens the sign-in, then brings you back here.')).toBeInTheDocument();
      await expect.element(page.getByText('Come back to it at the end')).toBeInTheDocument();

      // It arrived in view: its question is on screen, under the conversation.
      await new Promise(r => setTimeout(r, 600));

      expect(thread.scrollTop).toBeGreaterThan(0);
      expect(await inView(await page.getByTestId('decision-eyebrow').element() as HTMLElement) || await inView(await page.getByTestId('decision-submit').element() as HTMLElement)).toBe(true);

      // The thread scrolls naturally to the rest of it, Submit included.
      thread.scrollTop = thread.scrollHeight;
      await new Promise(r => requestAnimationFrame(() => r(null)));

      expect(await inView(await page.getByTestId('decision-submit').element() as HTMLElement)).toBe(true);

      // The box to type in stays below it, on the screen.
      const composer = (await page.getByRole('textbox').last().element() as HTMLElement).getBoundingClientRect();

      expect(composer.bottom).toBeLessThanOrEqual(h + 1);
      expect(composer.top).toBeGreaterThanOrEqual(thread.getBoundingClientRect().bottom - 1);
    });
  }

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
