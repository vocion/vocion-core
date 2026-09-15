import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn(), latestForScope: vi.fn() },
  },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  // The dock's back-to-everything link — a plain anchor is enough for tests.
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { client } = await import('@/libs/Orpc');
const { ChatDock, DOCK_WIDTH_CLASS, isRecallAsk } = await import('./ChatDock');

const AGENTS = [
  { slug: 'revops-lead', name: 'RevOps Lead', icon: 'bot' as const, placeholder: 'Ask about this lead…', role: 'lead' as const },
];

const SCOPE = 'contacts:9412';
const COLLAPSE_KEY = 'vocion_chat_dock_collapsed';

beforeEach(() => {
  localStorage.clear();
  vi.mocked(client.chatWidget.getState).mockReset().mockResolvedValue(null);
  vi.mocked(client.chatWidget.setState).mockReset().mockResolvedValue({ agentSlug: 'revops-lead', conversationId: null });
  vi.mocked(client.conversations.get).mockReset();
  vi.mocked(client.conversations.create).mockReset();
  vi.mocked(client.conversations.list).mockReset().mockResolvedValue([]);
  vi.mocked(client.conversations.latestForScope).mockReset().mockResolvedValue(null);
});

const { requestAgentSurface } = await import('./agentSurface');

const RUN = {
  id: 42,
  actionId: 'personalization.enroll',
  status: 'pending',
  input: {},
  invokedBy: null,
  proposal: null,
  card: {
    title: 'New MQL ready to enroll',
    fields: [],
    recommendation: { headline: 'Enroll in: MSP Triage Nurture · 2 sends' },
    verbs: { approve: 'Enroll', reject: 'Decline' },
    content: [
      { kind: 'email', id: 'send-1', label: 'Day 0', subject: 'Ticket volume', body: 'draft one body' },
    ],
  },
} as unknown as import('@/features/review/ReviewActionCard').ReviewCardRun;

describe('ChatDock', () => {
  it('claims the one entry function: a collapsed dock reopens and takes focus', async () => {
    localStorage.setItem(COLLAPSE_KEY, '1');
    await render(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Pete Laverick" />);

    await expect.element(page.getByRole('button', { name: 'Open the conversation' })).toBeInTheDocument();

    const claimed = requestAgentSurface();

    expect(claimed).toBe(true);
    await expect.element(page.getByRole('complementary', { name: 'Conversation about Pete Laverick' })).toBeInTheDocument();
    await expect.element(page.getByRole('textbox')).toHaveFocus();
  });

  it('puts the guided cards inline in the transcript, with the composer pinned to the bottom of the pane', async () => {
    await render(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Pete Laverick" run={RUN} />);

    const overview = await page.getByText('Enroll in: MSP Triage Nurture · 2 sends').element();
    const composer = await page.getByRole('textbox').element();
    const aside = await page.getByRole('complementary', { name: 'Conversation about Pete Laverick' }).element();

    // The cards are transcript content: inside the scrolling list, not a pane
    // of their own, and nothing of the empty state shows beside them.
    expect(overview.closest('.overflow-y-auto')).not.toBeNull();
    expect(page.getByRole('heading', { level: 2 }).elements()).toHaveLength(0);
    expect(overview.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The composer is the bottom edge of the pane.
    const paneBottom = aside.getBoundingClientRect().bottom;
    const composerBottom = composer.closest('.sticky')!.getBoundingClientRect().bottom;

    expect(Math.abs(paneBottom - composerBottom)).toBeLessThan(2);
    // With nothing after the cards there is nothing to recall.
    expect(page.getByRole('button', { name: 'Show my review cards' }).elements()).toHaveLength(0);
  });

  it('knows a question that asks for the cards back', () => {
    for (const ask of ['what do I need to review?', 'What do I still have to decide', 'where was I?', 'show me the cards', 'what\'s left to review', 'bring the review back up', 'what is pending']) {
      expect(isRecallAsk(ask), ask).toBe(true);
    }
    for (const notAsk of ['make send 2 shorter', 'who is Pete Laverick?', 'approve', 'what does Redpoint do']) {
      expect(isRecallAsk(notAsk), notAsk).toBe(false);
    }
  });

  it('opens to a third of the viewport, never under the old column width', async () => {
    await render(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Pete Laverick" />);

    const aside = page.getByRole('complementary', { name: 'Conversation about Pete Laverick' });

    await expect.element(aside).toBeVisible();
    expect(DOCK_WIDTH_CLASS).toBe('w-[max(24rem,33.333vw)]');
    expect(aside.element().className).toContain(DOCK_WIDTH_CLASS);
  });

  it('carries the chat menu in its header: new chat, recent threads, which agent', async () => {
    vi.mocked(client.conversations.list).mockResolvedValue([
      { id: 7, title: 'Earlier about the queue', messageCount: 4, updatedAt: new Date().toISOString() },
    ] as never);
    await render(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Pete Laverick" />);

    await userEvent.click(page.getByRole('button', { name: 'Chat options' }));

    await expect.element(page.getByRole('menuitem', { name: /New chat/ })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: /Earlier about the queue/ })).toBeVisible();
  });

  it('without a scope it is the everything conversation, collapsed by default when the page says so', async () => {
    await render(<ChatDock agents={AGENTS} scopeLabel="Everything" pageContext={{ path: '/dashboard/review', title: 'Review' }} defaultCollapsed />);

    await expect.element(page.getByRole('button', { name: 'Open the conversation' })).toBeVisible();
    expect(page.getByRole('complementary').elements()).toHaveLength(0);
    // Not scoped: the global pointer, never the per-record lookup.
    expect(vi.mocked(client.conversations.latestForScope)).not.toHaveBeenCalled();

    await userEvent.click(page.getByRole('button', { name: 'Open the conversation' }));

    await expect.element(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();
    await expect.element(page.getByText('Everything')).toBeVisible();
  });

  it('a stored choice wins over the page default, in both directions', async () => {
    localStorage.setItem(COLLAPSE_KEY, '0');
    await render(<ChatDock agents={AGENTS} scopeLabel="Everything" defaultCollapsed />);

    await expect.element(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();
  });

  it('sends where the person is with each turn when unscoped, and never when scoped', async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('', { status: 500 });
    }));
    try {
      await render(<ChatDock agents={AGENTS} scopeLabel="Everything" pageContext={{ path: '/dashboard/review', title: 'Review' }} />);
      await userEvent.fill(page.getByRole('textbox'), 'what is waiting?');
      await userEvent.keyboard('{Enter}');

      await expect.poll(() => calls.length).toBe(1);

      expect(calls[0]).toMatchObject({ message: 'what is waiting?', page_context: { path: '/dashboard/review', title: 'Review' } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders nothing when there are no agents', async () => {
    await render(<ChatDock agents={[]} scopeRef={SCOPE} scopeLabel="Pete Laverick" />);

    await expect.element(page.getByRole('complementary')).not.toBeInTheDocument();
  });

  it('defaults to open, with the scope in the header and the back-to-everything link', async () => {
    await render(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Pete Laverick" />);

    await expect.element(page.getByRole('complementary', { name: 'Conversation about Pete Laverick' })).toBeInTheDocument();
    await expect.element(page.getByText('Pete Laverick')).toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: 'All conversations' })).toBeInTheDocument();
  });

  it('resumes the user\'s scoped conversation instead of the global pointer', async () => {
    vi.mocked(client.conversations.latestForScope).mockResolvedValue(
      { id: 41, agentSlug: 'revops-lead', title: 'About Pete' } as never,
    );
    vi.mocked(client.conversations.get).mockResolvedValue({
      id: 41,
      agentSlug: 'revops-lead',
      title: 'About Pete',
      messages: [
        { role: 'user', content: 'why day 6 for the call?', runsJson: null, documentsJson: null, confidence: null },
        { role: 'assistant', content: 'The entrance path sets it.', runsJson: null, documentsJson: null, confidence: null },
      ],
    } as never);

    await render(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Pete Laverick" />);

    await expect.element(page.getByText('The entrance path sets it.')).toBeInTheDocument();
    expect(vi.mocked(client.conversations.latestForScope)).toHaveBeenCalledWith({ scopeRef: SCOPE });
    expect(vi.mocked(client.conversations.get)).toHaveBeenCalledWith({ id: 41 });
  });

  it('collapses to the reopen button and the choice persists', async () => {
    await render(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Pete Laverick" />);

    await userEvent.click(page.getByRole('button', { name: 'Collapse the conversation' }));

    await expect.element(page.getByRole('button', { name: 'Open the conversation' })).toBeInTheDocument();
    await expect.element(page.getByRole('complementary')).not.toBeInTheDocument();
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe('1');

    await userEvent.click(page.getByRole('button', { name: 'Open the conversation' }));

    await expect.element(page.getByRole('complementary', { name: 'Conversation about Pete Laverick' })).toBeInTheDocument();
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe('0');
  });
});
