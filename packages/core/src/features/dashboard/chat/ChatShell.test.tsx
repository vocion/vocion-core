import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

import { ShellBarActionsOutlet, ShellBarActionsProvider, ShellBarTitleOutlet, useShellBarTitleClaimed } from '@/features/dashboard/ShellBarActions';
import en from '@/locales/en.json';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn(), setRail: vi.fn(async () => ({ railWidth: null, railOpen: null })) },
    chat: { suggestions: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn(), search: vi.fn(async () => []), tail: vi.fn(async () => []), setAutonomy: vi.fn(), feedback: vi.fn(), rename: vi.fn(async () => ({})) },
    teams: { list: vi.fn(async () => ({ workspace: null, teams: [] })) },
    missions: { list: vi.fn(async () => []) },
    review: { actionStatus: vi.fn(async () => ({ status: 'pending', decidedBy: null, decidedAt: null })), decideAction: vi.fn(async () => ({ runId: 7763, status: 'approved' })) },
    decisions: { open: vi.fn(async () => []), waiting: vi.fn(async () => []), answer: vi.fn(async () => ({ decision: null, effect: null })), build: vi.fn() },
  },
}));

const replaceUrl = vi.hoisted(() => vi.fn());

vi.mock('@/libs/I18nNavigation', () => ({
  // The surfaces read the router for `/history`, `?new=1` and the preview's chat CTA — a stub is enough here.
  useRouter: () => ({ push: () => {}, replace: replaceUrl }),
  usePathname: () => '/dashboard/chat',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { client } = await import('@/libs/Orpc');
const { ChatShell } = await import('./ChatShell');

/**
 * The chat surfaces read their copy from the `Chat` namespace; tests render inside the provider the shell supplies.
 *
 * ChatShell puts its whole control cluster — the speaker chip, History, the
 * autonomy rung and the ⋯ menu — through `ShellBarActionsPortal` into the
 * dashboard's top bar, so a bare render drops all of it on the floor: the
 * portal returns `null` until an outlet has registered a node. The real
 * layout supplies both; so must the test wrapper.
 * @param ui
 */
function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <ShellBarActionsProvider>
        <CrumbStandIn />
        <ShellBarTitleOutlet />
        <ShellBarActionsOutlet />
        {ui}
      </ShellBarActionsProvider>
    </NextIntlClientProvider>
  );
}

/** Stands in for the bar's breadcrumb: shown until a page claims the title slot, as `AppSidebarHeader` does. */
function CrumbStandIn() {
  return useShellBarTitleClaimed() ? null : <span data-testid="crumb">Squatch Factory</span>;
}

/**
 * The user-message bubbles that say this text. The thread title repeats it in a span, which is not a message.
 * @param text - What was sent.
 */
function sentBubbles(text: string) {
  return page.getByText(text).elements().filter(element => element.tagName === 'DIV');
}

const AGENTS = [
  { slug: 'orchestrator', name: 'GTM Orchestrator', icon: 'bot' as const, placeholder: 'Ask…', role: 'lead' as const },
  { slug: 'specialist', name: 'Pipeline Analyst', icon: 'bot' as const, placeholder: 'Ask…', role: 'specialist' as const },
];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(client.chatWidget.getState).mockReset().mockResolvedValue(null);
  vi.mocked(client.chatWidget.setState).mockReset().mockResolvedValue({ agentSlug: 'orchestrator', conversationId: null });
  vi.mocked(client.chat.suggestions).mockReset().mockResolvedValue([]);
  vi.mocked(client.conversations.get).mockReset();
  vi.mocked(client.conversations.create).mockReset();
  replaceUrl.mockReset();
  vi.mocked(client.conversations.list).mockReset().mockResolvedValue([]);
  vi.mocked(client.decisions.open).mockReset().mockResolvedValue([] as never);
  vi.mocked(client.decisions.waiting).mockReset().mockResolvedValue([] as never);
  vi.mocked(client.decisions.answer).mockReset().mockResolvedValue({ decision: null, effect: null } as never);
});

describe('ChatShell', () => {
  it('opens on the team, two short lines and "Ask the team…": no "Ask <workspace>" heading (founder, 2026-10-09)', async () => {
    // "Your team is here": the centre is the workspace's agents, lead first,
    // with a caption that opens the team; the lines say the team is on it.
    await render(wrap(<ChatShell agents={AGENTS} greeting={{ workspace: 'GTM Workspace' }} />));

    await expect.element(page.getByTestId('chat-greeting')).toBeInTheDocument();
    await expect.element(page.getByTestId('chat-greeting-team')).toHaveTextContent('GTM Workspace\'s team is on it.');
    await expect.element(page.getByTestId('team-caption')).toHaveTextContent('GTM Orchestrator · 2 agents');
    await expect.element(page.getByTestId('team-caption')).toHaveAttribute('href', '/dashboard/teams');
    expect(page.getByTestId('team-member').elements()).toHaveLength(1);
    await expect.element(page.getByPlaceholder('Ask the team…')).toBeInTheDocument();
    expect(page.getByText(/Ask GTM Workspace/).elements()).toHaveLength(0);
  });

  it('has no agent picker: the surface speaks as the workspace; New chat is an icon, and ⋯ never lists an agent (§9.10)', async () => {
    await render(wrap(<ChatShell agents={AGENTS} />));

    await expect.element(page.getByRole('button', { name: 'New chat' })).toBeVisible();

    await page.getByRole('button', { name: 'Chat options' }).click();

    // New chat is never a row inside ⋯ (Chris, 2026-09-24: "promote that
    // icon out of the context menu"); the menu keeps All conversations.
    await expect.element(page.getByRole('menuitem', { name: /All conversations/ })).toBeVisible();
    expect(page.getByRole('menuitem', { name: /New chat/ }).elements()).toHaveLength(0);
    expect(page.getByRole('menuitem', { name: /Pipeline Analyst/ }).elements()).toHaveLength(0);
  });

  it('starts warm: what waits elsewhere is one soft chip to Review, never a docked card (founder, 2026-10-08)', async () => {
    // Jamie's waiting proposals (2026-10-07) opened every new chat as a big
    // card carousel the founder could not scroll past on a phone. An empty
    // conversation now says how many, once; Review holds them, and a
    // conversation under way queues them in its dock.
    vi.mocked(client.decisions.waiting).mockResolvedValue([
      { id: 7763, subject: 'proposal', kind: 'approval', question: 'Create product: Northwind Traders', options: [{ id: 'approve', label: 'Allow once', recommended: true }, { id: 'reject', label: 'Deny' }], allowOther: true, multiple: false, state: 'open', agentSlug: 'product-manager', ownerUserId: null, conversationId: null },
      { id: 41, kind: 'question', question: 'What should the export be called?', options: [], allowOther: true, multiple: false, state: 'open', agentSlug: 'product-manager', ownerUserId: null, conversationId: null },
      { id: 42, kind: 'question', question: 'Which region is Northwind in?', options: [], allowOther: true, multiple: false, state: 'open', agentSlug: 'product-manager', ownerUserId: null, conversationId: null },
    ] as never);
    sessionStorage.clear();
    await render(wrap(<ChatShell agents={AGENTS} greeting={{ workspace: 'GTM Workspace' }} />));

    await expect.element(page.getByTestId('chat-greeting')).toHaveTextContent(/^(Good (morning|afternoon|evening)|Welcome back)\.$/);

    const nudge = page.getByTestId('waiting-nudge');

    await expect.element(nudge.getByRole('link', { name: '3 things waiting on you' })).toHaveAttribute('href', '/dashboard/inbox');
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    expect(page.getByText('Create product: Northwind Traders').elements()).toHaveLength(0);

    // Dismissible: gone for this browser session.
    await nudge.getByRole('button', { name: 'Not now' }).click();

    expect(page.getByTestId('waiting-nudge').elements()).toHaveLength(0);
    expect(sessionStorage.getItem('vocion:waiting-nudge-dismissed')).toBe('1');
  });

  it('draws no dock when nothing waits', async () => {
    await render(wrap(<ChatShell agents={AGENTS} />));

    await expect.element(page.getByPlaceholder('Ask the team…')).toBeInTheDocument();
    expect(page.getByTestId('waiting-nudge').elements()).toHaveLength(0);
    expect(page.getByTestId('decision-dock').elements()).toHaveLength(0);
  });

  it('shows an empty state instead of crashing when there are no agents', async () => {
    // `chat/page.tsx` hands over an empty list whenever it cannot resolve a
    // workspace. `useChatSession` reads `agents[0]!.slug`, so the page used to
    // throw here rather than render anything.
    await render(wrap(<ChatShell agents={[]} />));

    await expect.element(page.getByText('No agents to chat with')).toBeInTheDocument();
    // The guard has to sit above the hook: no agent means nothing to fetch
    // state for, and the mount effect must not run at all.
    expect(client.chatWidget.getState).not.toHaveBeenCalled();
  });

  it('holds a boot skeleton and an unarmed Send until the saved-thread lookup settles', async () => {
    // Control exactly when `useLastViewedConversation`'s server round-trip
    // resolves, so we can assert the pre-boot state mid-flight instead of
    // only after everything has already settled. No persisted conversation
    // here, so once this resolves boot settles with no further
    // `conversations.get` fetch to wait on.
    let resolveGetState!: (value: unknown) => void;
    const getStatePromise = new Promise((resolve) => {
      resolveGetState = resolve;
    });
    vi.mocked(client.chatWidget.getState).mockReturnValue(getStatePromise as never);

    await render(wrap(<ChatShell agents={AGENTS} />));

    // Boot is still in flight — the skeleton stands in for the transcript, so
    // there is no greeting yet, and Send is not armed, so a
    // message can't be sent (and then silently discarded when the restored
    // transcript lands). The BOX itself never locks (2026-09-15): people type
    // their thought while the app catches up.
    await expect.element(page.getByPlaceholder('Ask the team…')).not.toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(page.getByTestId('chat-greeting').elements()).toHaveLength(0);

    resolveGetState(null);

    await expect.element(page.getByTestId('chat-greeting')).toBeInTheDocument();
  });

  it('keeps the workspace crumb for a new chat, and names the page by its thread once there is one', async () => {
    await render(wrap(<ChatShell agents={AGENTS} />));

    await expect.element(page.getByPlaceholder('Ask the team…')).toBeInTheDocument();
    await expect.element(page.getByTestId('crumb')).toBeInTheDocument();
    expect(page.getByTestId('chat-title').elements()).toHaveLength(0);
  });

  it('shows a resumed thread\'s title in the header in place of the workspace, and renames it inline', async () => {
    vi.mocked(client.conversations.get).mockResolvedValue({
      id: 64,
      agentSlug: 'orchestrator',
      title: 'Contoso supply forecast',
      titleSource: 'generated',
      messages: [
        { role: 'user', content: 'what does contoso need next quarter?', runsJson: null, documentsJson: null, confidence: null },
        { role: 'assistant', content: 'Roughly 4,000 units.', runsJson: null, documentsJson: null, confidence: null },
      ],
    } as never);

    await render(wrap(<ChatShell agents={AGENTS} conversationId={64} />));

    const title = page.getByTestId('chat-title');

    await expect.element(title).toHaveTextContent('Contoso supply forecast');
    expect(page.getByTestId('crumb').elements()).toHaveLength(0);

    await userEvent.click(title);
    await userEvent.fill(page.getByRole('textbox', { name: 'Conversation title' }), 'Contoso Q4 demand');
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByTestId('chat-title')).toHaveTextContent('Contoso Q4 demand');
    expect(vi.mocked(client.conversations.rename)).toHaveBeenCalledWith({ id: 64, title: 'Contoso Q4 demand' });

    // Escape leaves the name alone.
    await userEvent.click(page.getByTestId('chat-title'));
    await userEvent.fill(page.getByRole('textbox', { name: 'Conversation title' }), 'Never mind');
    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByTestId('chat-title')).toHaveTextContent('Contoso Q4 demand');
    expect(vi.mocked(client.conversations.rename)).toHaveBeenCalledTimes(1);
  });

  it('lists threads by title in the history dropdown', async () => {
    vi.mocked(client.conversations.list).mockResolvedValue([
      { id: 7, title: 'Bellwater Hall booking', titleSource: 'generated' },
      { id: 8, title: 'Acme renewal terms', titleSource: 'person' },
    ] as never);

    await render(wrap(<ChatShell agents={AGENTS} />));

    await userEvent.click(page.getByRole('button', { name: 'Conversations' }));

    await expect.element(page.getByRole('button', { name: 'Bellwater Hall booking' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Acme renewal terms' })).toBeVisible();
  });

  it('back from a login, the setup step that opened it is answered — typed, once — and the connect params leave the URL', async () => {
    // The turn's network call never answers: what is under test is that the
    // answer leaves as a typed decision, never as "I connected github".
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchSpy);
    sessionStorage.setItem('vocion:chat:session:orchestrator', '7');
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'orchestrator', conversationId: 7, updatedAt: new Date(), railWidth: null, railOpen: null } as never);
    vi.mocked(client.conversations.get).mockResolvedValue({ id: 7, orgId: 'org_1', agentSlug: 'orchestrator', title: 'Set up', messageCount: 1, messages: [{ id: 1, conversationId: 7, role: 'assistant', content: 'Connect GitHub first.', runsJson: null, createdAt: new Date() }] } as never);
    vi.mocked(client.decisions.open).mockResolvedValue([
      { id: 52, kind: 'setup', question: 'Connect GitHub', options: [{ id: 'connect:github', label: 'Connect with GitHub', href: '/api/connect/github/start?connector=github' }], allowOther: true, multiple: false, state: 'open', agentSlug: 'orchestrator', ownerUserId: 'usr-dana', conversationId: 7 },
    ] as never);
    window.history.replaceState(null, '', '/dashboard/chat?conversation=7&connect=ok&connector=github');
    const screen = await render(wrap(<ChatShell agents={AGENTS} conversationId={7} connectReturn={{ ok: true, connector: 'github' }} />));

    const turns = () => fetchSpy.mock.calls.filter(([url, init]) => url === '/rpc/agent/stream' && init?.method === 'POST');
    await vi.waitFor(() => expect(turns()).toHaveLength(1));
    const body = JSON.parse(String(turns()[0]![1]!.body));

    expect(body.decision_answer).toEqual({ id: 52, option_ids: ['connect:github'] });
    expect(body.message).toBe('');
    expect(sentBubbles('I connected github. What\'s next?')).toHaveLength(0);

    await vi.waitFor(() => expect(replaceUrl).toHaveBeenCalledWith('/dashboard/chat?conversation=7'));

    await screen.rerender(wrap(<ChatShell agents={AGENTS} conversationId={7} connectReturn={{ ok: true, connector: 'github' }} />));

    expect(turns()).toHaveLength(1);

    window.history.replaceState(null, '', '/dashboard/chat');
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('sends nothing when the page was opened without a connect outcome', async () => {
    const fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchSpy);
    await render(wrap(<ChatShell agents={AGENTS} />));

    await expect.element(page.getByPlaceholder('Ask the team…')).toBeInTheDocument();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(replaceUrl).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
