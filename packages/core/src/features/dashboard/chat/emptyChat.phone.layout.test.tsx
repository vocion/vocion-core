import type { DecisionView } from '@/libs/decisions/decision';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { ShellBarActionsOutlet, ShellBarActionsProvider, ShellBarTitleOutlet } from '@/features/dashboard/ShellBarActions';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * An empty chat, on a phone, in a real browser at iPhone size.
 *
 * The founder's screenshot (2026-10-08, Noco's workspace, an iPhone): a new
 * chat opened on "Waiting on you · Suggested actions 3 of 3", one big card
 * whose title was its own rationale cut short, a 72% badge, Approve / Reject,
 * and "Decide in review →". It filled the screen and he could not scroll to
 * the conversation. Asserted here, not described: an empty chat is a greeting
 * and a few chips; what waits is one soft chip; nothing is a card; the
 * conversation pane scrolls; and nothing pinned above the composer is taller
 * than a quarter of the screen.
 */

/** Three proposals waiting, the founder's count, with the long rationale-as-title the old card drew. */
function waiting(): DecisionView[] {
  const RATIONALE = 'The operating intent names this as one of three repositories in the factory scope and states its reliability bar, so it belongs on the board.';
  return [1, 2, 3].map(n => ({ id: n, subject: 'proposal' as const, kind: 'approval' as const, question: RATIONALE, body: RATIONALE, options: [{ id: 'approve', label: 'Allow once', recommended: true }, { id: 'reject', label: 'Deny' }], allowOther: true, multiple: false, state: 'open' as const, agentSlug: 'lead', ownerUserId: null, conversationId: null }));
}

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(async () => null), setState: vi.fn(async () => ({ agentSlug: 'lead', conversationId: null })), setRail: vi.fn(async () => ({ railWidth: null, railOpen: null })) },
    chat: { suggestions: vi.fn(async () => []) },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn(async () => []), search: vi.fn(async () => []), tail: vi.fn(async () => []), setAutonomy: vi.fn(), feedback: vi.fn(), rename: vi.fn(async () => ({})) },
    teams: { list: vi.fn(async () => ({ workspace: null, teams: [] })) },
    missions: { list: vi.fn(async () => []) },
    review: { actionStatus: vi.fn(async () => ({ status: 'pending', decidedBy: null, decidedAt: null })), decideAction: vi.fn() },
    // What waits elsewhere reaches the chat as Decisions (`decisions.waiting`).
    decisions: { open: vi.fn(async () => []), waiting: vi.fn(async () => waiting()), answer: vi.fn(), build: vi.fn() },
  },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { ChatShell } = await import('./ChatShell');
const { ChatComposer } = await import('./ChatComposer');

const PHONE = { width: 390, height: 844 };

const AGENTS = [
  { slug: 'lead', name: 'Revenue lead', icon: 'bot' as const, placeholder: 'Ask…', role: 'lead' as const },
  { slug: 'analyst', name: 'Pipeline Analyst', icon: 'bot' as const, placeholder: 'Ask…', role: 'specialist' as const },
];

function Shell() {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <ShellBarActionsProvider>
        <ShellBarTitleOutlet />
        <ShellBarActionsOutlet />
        <div style={{ height: PHONE.height }} className="flex flex-col" data-testid="phone-screen">
          <ChatShell agents={AGENTS} greeting={{ workspace: 'Northwind' }} />
        </div>
      </ShellBarActionsProvider>
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('an empty chat on a phone', () => {
  it('is a mark, one line and one soft chip by the composer: no heading, no starters, no cards, no badge', async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await render(<Shell />);

    await expect.element(page.getByTestId('chat-greeting')).toHaveTextContent(/^(Good (morning|afternoon|evening)|Welcome back)\.$/);
    await expect.element(page.getByTestId('team-cluster')).toBeVisible();

    // The only buttons in the empty pane are the chip's own dismiss: no starters.
    const empty = page.getByTestId('chat-empty-state');

    expect(empty.getByRole('button').elements().map(b => b.getAttribute('data-testid'))).toEqual(['waiting-nudge-dismiss']);
    await expect.element(page.getByPlaceholder('Ask the team…')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Ask Northwind/i);
    await expect.element(page.getByTestId('waiting-nudge')).toHaveTextContent('3 things waiting on you');

    expect(page.getByTestId('recommended-action-card').elements()).toHaveLength(0);
    expect(page.getByTestId('recommended-action-stack').elements()).toHaveLength(0);
    expect(page.getByTestId('waiting-on-you').elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Suggested actions');
    expect(document.body.textContent).not.toContain('72%');
    expect(document.body.textContent).not.toContain('operating intent');
  });

  it('keeps the conversation scrollable, the composer on screen, and nothing sideways', async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await render(<Shell />);

    const empty = await page.getByTestId('chat-empty-state').element() as HTMLElement;
    const style = getComputedStyle(empty);

    // The pane scrolls on its own, so a short screen never traps the greeting.
    expect(style.overflowY).toBe('auto');
    expect(empty.getBoundingClientRect().height).toBeGreaterThan(PHONE.height * 0.5);

    // The box you type in is on the screen, under the greeting.
    const screen = (await page.getByTestId('phone-screen').element() as HTMLElement).getBoundingClientRect();
    const composer = await page.getByRole('textbox').first().element() as HTMLElement;
    const box = composer.getBoundingClientRect();

    expect(box.bottom).toBeLessThanOrEqual(screen.bottom);
    expect(box.top).toBeGreaterThan(empty.getBoundingClientRect().top);

    // The line sits in the middle of the pane; the chip is tucked by the composer.
    const line = (await page.getByTestId('chat-greeting').element() as HTMLElement).getBoundingClientRect();
    const pane = empty.getBoundingClientRect();
    const middle = pane.top + pane.height / 2;

    expect(Math.abs((line.top + line.bottom) / 2 - middle)).toBeLessThan(pane.height * 0.2);

    const chip = (await page.getByTestId('waiting-nudge').element() as HTMLElement).getBoundingClientRect();

    expect(chip.top).toBeGreaterThan(line.bottom);
    expect(box.top - chip.bottom).toBeLessThan(80);

    const doc = document.scrollingElement!;

    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
  });

  it('caps nothing above the composer and scrolls nothing inside a box: a Decision lives in the thread (founder, 2026-10-09)', async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <div style={{ height: PHONE.height }} className="flex flex-col justify-end">
          <ChatComposer
            above={<div data-testid="chip-row" style={{ height: 40 }}>A chip</div>}
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
          />
        </div>
      </NextIntlClientProvider>,
    );

    const above = await page.getByTestId('composer-above').element() as HTMLElement;

    expect(getComputedStyle(above).overflowY).toBe('visible');
    expect(getComputedStyle(above).maxHeight).toBe('none');
  });
});
