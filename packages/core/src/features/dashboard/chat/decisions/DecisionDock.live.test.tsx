import type { DecisionView } from '@/libs/decisions/decision';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * THE DOCK IS LIVE (Chris, 2026-10-23: "are we streaming updates to the card
 * if they're decided or overcome by work in chat?"). A docked Decision
 * settled anywhere else — Review, another tab, Slack, a teammate — is read
 * again the moment its row changes on the live stream, leaves the dock, and
 * the dock says so once. Fixtures are fictional (Northwind).
 */

const notices: Array<{ topics: readonly string[]; on: () => void }> = [];
vi.mock('@/hooks/useLive', () => ({
  useLive: (topics: readonly string[], on: () => void) => {
    notices.push({ topics, on });
    return { live: true, state: 'open' };
  },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
}));
vi.mock('@/features/preview/previewState', () => ({ openPreview: vi.fn() }));
vi.mock('@/libs/Orpc', () => ({ client: { connectSystems: { plan: vi.fn(async () => ({ candidates: [], connected: [], question: null, scope: null, refused: null })) } } }));

const { ConversationDecisions } = await import('./DecisionDock');

const intro: DecisionView = {
  id: 503,
  subject: 'ask',
  kind: 'approval',
  question: 'Draft the Northwind intro note?',
  options: [{ id: 'allow', label: 'Allow once', recommended: true }, { id: 'deny', label: 'Deny' }],
  allowOther: true,
  multiple: false,
  state: 'open',
  agentSlug: 'founder-gtm-lead',
  ownerUserId: 'usr-dana',
  conversationId: 9,
};

type Session = Parameters<typeof ConversationDecisions>[0]['session'];

function session(over: Partial<Session> = {}): Session {
  return {
    openDecisions: [intro],
    waitingDecisions: [],
    dockNotice: null,
    dismissDockNotice: () => {},
    answerDecision: () => {},
    answeringDecisionId: null,
    decisionError: null,
    agentNameOf: () => 'Founder GTM Lead',
    conversationId: 9,
    sendMessage: () => {},
    messages: [{}, {}],
    isStreaming: false,
    ...over,
  };
}

describe('the docked Decision, live', () => {
  it('follows its own row and, settled elsewhere, leaves the dock saying so once', async () => {
    const refreshDecisions = vi.fn();
    const screen = await render(<ConversationDecisions session={session({ refreshDecisions })} />);

    await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    expect(notices.at(-1)!.topics).toEqual(['ask:503']);

    // Approved on Review in another tab: the stream rings, the dock reads again…
    notices.at(-1)!.on();

    expect(refreshDecisions).toHaveBeenCalledTimes(1);

    // …and the read comes back without it.
    await screen.rerender(<ConversationDecisions session={session({ refreshDecisions, openDecisions: [] })} />);

    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    await expect.element(page.getByTestId('decision-notice')).toHaveTextContent('Settled elsewhere: Draft the Northwind intro note?');
  });

  it('says nothing about one answered here', async () => {
    const refreshDecisions = vi.fn();
    const screen = await render(<ConversationDecisions session={session({ refreshDecisions })} />);
    await page.getByTestId('decision-submit').click();
    notices.at(-1)!.on();
    await screen.rerender(<ConversationDecisions session={session({ refreshDecisions, openDecisions: [] })} />);

    expect(page.getByTestId('decision-notice').elements()).toHaveLength(0);
  });
});
