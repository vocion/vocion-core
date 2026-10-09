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

const { ConversationDecisions } = await import('./DecisionDock');
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

type Session = Parameters<typeof ConversationDecisions>[0]['session'];

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

function Phone({ s, height = 844 }: { s: Session; height?: number }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <div style={{ height }} className="flex flex-col justify-end" data-testid="phone-screen">
        <div className="min-h-0 flex-1" data-testid="thread" />
        <ChatComposer above={<ConversationDecisions session={s} />} value="" onChange={() => {}} onSubmit={() => {}} />
      </div>
    </NextIntlClientProvider>
  );
}

/**
 * Whether an element is drawn inside the slot's visible window (and the screen).
 * @param el - The element.
 */
async function inView(el: HTMLElement): Promise<boolean> {
  const slot = (await page.getByTestId('composer-above').element() as HTMLElement).getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.top >= slot.top - 1 && r.bottom <= slot.bottom + 1 && r.bottom <= window.innerHeight + 1;
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

  it('is one quiet chip once the turn lands, and docks here only when tapped', async () => {
    await page.viewport(390, 844);
    await render(<Phone s={session()} />);

    expect(page.getByTestId('decision-card').elements()).toHaveLength(0);
    await expect.element(page.getByTestId('waiting-nudge')).toHaveTextContent('1 thing waiting on you');

    await page.getByTestId('waiting-nudge-open').click();

    await expect.element(page.getByTestId('decision-card')).toBeVisible();
    // Said once: never "Waiting on you · A decision for you".
    await expect.element(page.getByTestId('decision-eyebrow')).toHaveTextContent(/^Waiting on you$/i);
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

describe('a docked card taller than its slot', () => {
  for (const [label, w, h] of [['a phone', 390, 844], ['a phone with the keyboard up', 390, 508], ['a phone on its side', 844, 390]] as const) {
    it(`keeps its question and its buttons in view on ${label}`, async () => {
      await page.viewport(w, h);
      await render(<Phone s={session({ openDecisions: [connectGitHub] })} height={h} />);

      const slot = await page.getByTestId('composer-above').element() as HTMLElement;

      // Taller than the slot: the middle scrolls…
      expect(slot.scrollHeight).toBeGreaterThan(slot.clientHeight);

      // …the question does not, and — wherever head and foot both fit —
      // neither does Submit, with the recommendation between them.
      const roomy = h > 600 || w >= 768;

      expect(await inView(await page.getByTestId('decision-head').element() as HTMLElement)).toBe(true);

      if (roomy) {
        expect(await inView(await page.getByTestId('decision-submit').element() as HTMLElement)).toBe(true);
      }
      if (h > 600) {
        expect(await inView(await page.getByRole('option', { name: /Connect GitHub/ }).element() as HTMLElement)).toBe(true);
      }

      slot.scrollTop = slot.scrollHeight / 2;
      await new Promise(r => requestAnimationFrame(() => r(null)));

      expect(await inView(await page.getByTestId('decision-head').element() as HTMLElement)).toBe(true);

      if (roomy) {
        expect(await inView(await page.getByTestId('decision-submit').element() as HTMLElement)).toBe(true);
      }
      // Never one over the other.
      const head = (await page.getByTestId('decision-head').element() as HTMLElement).getBoundingClientRect();
      const foot = (await page.getByTestId('decision-foot').element() as HTMLElement).getBoundingClientRect();

      expect(foot.top >= head.bottom - 1 || foot.bottom <= head.top + 1).toBe(true);

      // The box to type in is still on the screen.
      const composer = (await page.getByRole('textbox').last().element() as HTMLElement).getBoundingClientRect();

      expect(composer.bottom).toBeLessThanOrEqual(h + 1);
      expect(slot.getBoundingClientRect().height).toBeLessThanOrEqual(h * 0.45 + 1);
    });
  }

  it('opens a new card on its question, not where the last one was left', async () => {
    await page.viewport(390, 844);
    const screen = await render(<Phone s={session({ openDecisions: [connectGitHub] })} />);
    const slot = await page.getByTestId('composer-above').element() as HTMLElement;
    slot.scrollTop = 120;

    await screen.rerender(<Phone s={session({ openDecisions: [{ ...connectGitHub, id: 13, question: 'Connect Sentry' }] })} />);

    await expect.element(page.getByRole('heading', { name: 'Connect Sentry' })).toBeVisible();
    expect(slot.scrollTop).toBe(0);
  });

  it('gives every control a thumb\'s 44px on a phone', async () => {
    await page.viewport(390, 844);
    await render(<Phone s={session({ openDecisions: [connectGitHub] })} />);

    const slot = await page.getByTestId('composer-above').element() as HTMLElement;
    const small = [...slot.querySelectorAll<HTMLElement>('button, input, [role=option]')]
      .map(el => ({ el: el.dataset.testid ?? el.getAttribute('aria-label') ?? el.textContent, h: el.getBoundingClientRect().height }))
      .filter(t => t.h < 44);

    expect(small).toEqual([]);
  });
});
