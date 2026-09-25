import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

import en from '@/locales/en.json';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn(), setRail: vi.fn(async () => ({ railWidth: null, railOpen: null })) },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn(), latestForScope: vi.fn(), search: vi.fn(async () => []), tail: vi.fn(async () => []), setAutonomy: vi.fn(), feedback: vi.fn() },
    teams: { list: vi.fn(async () => ({ workspace: null, teams: [] })) },
    missions: { list: vi.fn(async () => []) },
  },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  // The surfaces read the router for `/history`, `?new=1` and the preview's chat CTA — a stub is enough here.
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
  // The dock's back-to-everything link — a plain anchor is enough for tests.
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { client } = await import('@/libs/Orpc');
const { ChatDock, DOCK_WIDTH_CLASS, isRecallAsk } = await import('./ChatDock');

/**
 * The chat surfaces read their copy from the `Chat` namespace; tests render inside the provider the shell supplies.
 * @param ui
 */
function wrap(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>;
}

const AGENTS = [
  { slug: 'revops-lead', name: 'RevOps Lead', icon: 'bot' as const, placeholder: 'Ask about this lead…', role: 'lead' as const },
];

const SCOPE = 'contacts:9412';
const COLLAPSE_KEY = 'vocion_chat_dock_collapsed';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(client.chatWidget.getState).mockReset().mockResolvedValue(null);
  vi.mocked(client.chatWidget.setState).mockReset().mockResolvedValue({ agentSlug: 'revops-lead', conversationId: null });
  vi.mocked(client.conversations.get).mockReset();
  vi.mocked(client.conversations.create).mockReset();
  vi.mocked(client.conversations.list).mockReset().mockResolvedValue([]);
  vi.mocked(client.conversations.latestForScope).mockReset().mockResolvedValue(null);
});

const { requestAgentSurface } = await import('./agentSurface');
const { PageContextProvider } = await import('@/features/dashboard/context/PageContextProvider');
const { RecordContext } = await import('@/features/dashboard/context/RecordContext');
const { DRAFT_REVISED_EVENT } = await import('@/features/personalization/draftRevision');

/**
 * The rail as it actually stands on the lead page: inside the shell's page
 * context, beside a page that has declared which record it is.
 * @param ui - The dock under test.
 */
function onRecordPage(ui: React.ReactNode) {
  return wrap(
    <PageContextProvider>
      <RecordContext record={{ type: 'object', id: SCOPE, label: 'Rowan Pike', href: '/gtm/lead/9412' }} />
      {ui}
    </PageContextProvider>,
  );
}

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
} as unknown as import('@/features/review/ReviewSurface').ReviewCardRun;

describe('ChatDock', () => {
  it('claims the one entry function: a collapsed dock reopens and takes focus', async () => {
    localStorage.setItem(COLLAPSE_KEY, '1');
    await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" />));

    await expect.element(page.getByRole('button', { name: 'Open the conversation (⌘J)' })).toBeInTheDocument();

    const claimed = requestAgentSurface();

    expect(claimed).toBe(true);
    await expect.element(page.getByRole('complementary', { name: 'Conversation about Rowan Pike' })).toBeInTheDocument();
    await expect.element(page.getByRole('textbox')).toHaveFocus();
  });

  it('puts the guided cards inline in the transcript, with the composer pinned to the bottom of the pane', async () => {
    await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" run={RUN} />));

    const overview = await page.getByText('Enroll in: MSP Triage Nurture · 2 sends').element();
    const composer = await page.getByRole('textbox').element();
    const aside = await page.getByRole('complementary', { name: 'Conversation about Rowan Pike' }).element();

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

  it('beside the record page it renders the conversation, never a second copy of the sends', async () => {
    await render(onRecordPage(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" run={RUN} />));

    await expect.element(page.getByTestId('sequence-pointer')).toBeVisible();

    // Not the overview, not the send, not the walk: the page owns all three.
    expect(page.getByTestId('guided-review').elements()).toHaveLength(0);
    expect(page.getByText('draft one body').elements()).toHaveLength(0);
    expect(page.getByText('Sequence overview').elements()).toHaveLength(0);

    // And no verb — a decision about the record belongs on the record's bar.
    for (const verb of [/Looks good/, /^Enroll$/, /^Snooze$/, /^Decline$/]) {
      expect(page.getByRole('button', { name: verb }).elements(), String(verb)).toHaveLength(0);
    }
  });

  it('the pointer is one line at the TOP of the transcript, and it points rather than acts', async () => {
    await render(onRecordPage(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" run={RUN} />));

    const pointer = await page.getByTestId('sequence-pointer').element();
    const link = await page.getByRole('button', { name: 'Show me the sends on the page' }).element();

    // Inside the scrolling transcript, and the first thing in it.
    expect(pointer.closest('.overflow-y-auto')).not.toBeNull();
    expect(pointer.parentElement?.previousElementSibling).toBeNull();
    // A text link, not a filled action.
    expect(link.className).toContain('underline');
    expect(link.className).not.toContain('bg-brand-amber');
  });

  it('the guided panel survives where nothing else renders the record — the chat-only surface', async () => {
    // Same dock, same run, no page declaring the record: the rail IS the only
    // rendering of the decision, so it renders it.
    await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" run={RUN} />));

    await expect.element(page.getByTestId('guided-review')).toBeVisible();
    expect(page.getByTestId('sequence-pointer').elements()).toHaveLength(0);
  });

  it('a page about a DIFFERENT record does not silence the rail', async () => {
    await render(wrap(
      <PageContextProvider>
        <RecordContext record={{ type: 'object', id: 'contacts:1', label: 'Someone else' }} />
        <ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" run={RUN} />
      </PageContextProvider>,
    ));

    await expect.element(page.getByTestId('guided-review')).toBeVisible();
  });

  it('beside the record page a rewrite is REPORTED, and the new copy goes to the page', async () => {
    const rewriteDraft = vi.fn(async () => ({ body: 'a shorter draft one body' }));
    // @ts-expect-error — the mocked client is shaped per test.
    client.review = { rewriteDraft, actionStatus: vi.fn(async () => ({ status: 'pending', decidedBy: null, decidedAt: null })) };
    const revised: Array<{ runId: number; contentId: string; body: string }> = [];
    const onRevised = (e: Event) => revised.push((e as CustomEvent<{ runId: number; contentId: string; body: string }>).detail);
    window.addEventListener(DRAFT_REVISED_EVENT, onRevised);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    try {
      await render(onRecordPage(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" run={RUN} />));
      requestAgentSurface({ tags: [{ type: 'intent', id: 'change', label: 'Change the draft' }] });

      await expect.element(page.getByTestId('composer-tag')).toBeVisible();

      await userEvent.fill(page.getByRole('textbox'), 'this opener is too long');
      await userEvent.keyboard('{Enter}');

      await vi.waitFor(() => expect(revised).toHaveLength(1));

      // The page is told the new copy; the rail says what it did and still
      // does not print the send.
      expect(revised[0]).toEqual({ runId: 42, contentId: 'send-1', body: 'a shorter draft one body' });
      await expect.element(page.getByText(/I rewrote Day 0/)).toBeVisible();
      expect(page.getByText('a shorter draft one body').elements()).toHaveLength(0);
    } finally {
      window.removeEventListener(DRAFT_REVISED_EVENT, onRevised);
      vi.unstubAllGlobals();
    }
  });

  it('knows a question that asks for the cards back', () => {
    for (const ask of ['what do I need to review?', 'What do I still have to decide', 'where was I?', 'show me the cards', 'what\'s left to review', 'bring the review back up', 'what is pending']) {
      expect(isRecallAsk(ask), ask).toBe(true);
    }
    for (const notAsk of ['make send 2 shorter', 'who is Rowan Pike?', 'approve', 'what does Contoso do']) {
      expect(isRecallAsk(notAsk), notAsk).toBe(false);
    }
  });

  it('opens to a third of the viewport, never under the old column width, and the width is a pixel value it can resize', async () => {
    await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" defaultCollapsed={false} />));

    const aside = page.getByRole('complementary', { name: 'Conversation about Rowan Pike' });

    await expect.element(aside).toBeVisible();
    // The legacy class is still exported for callers; the rail itself sizes in px (§9).
    expect(DOCK_WIDTH_CLASS).toBe('w-[max(24rem,33.333vw)]');

    const width = Number.parseInt((aside.element() as HTMLElement).style.width, 10);

    expect(width).toBeGreaterThanOrEqual(384);
    expect(width).toBeLessThanOrEqual(Math.max(384, Math.floor(window.innerWidth / 2)));
    await expect.element(page.getByRole('slider', { name: 'Resize the conversation' })).toBeInTheDocument();
  });

  it('carries New chat as an icon (no agent picker, §9.10) and, unscoped, a history popover with the recent threads', async () => {
    vi.mocked(client.conversations.list).mockResolvedValue([
      { id: 7, title: 'Earlier about the queue', messageCount: 4, updatedAt: new Date().toISOString() },
    ] as never);
    localStorage.setItem(COLLAPSE_KEY, '0');
    await render(wrap(<ChatDock agents={AGENTS} scopeLabel="Everything" />));

    await expect.element(page.getByRole('button', { name: 'New chat' })).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: 'Chat options' }));

    expect(page.getByRole('menuitem', { name: /New chat/ }).elements()).toHaveLength(0);

    await userEvent.keyboard('{Escape}');

    // The history trigger is named "Conversations" since #345 — it is the
    // way to the thread list, not a label for the icon.
    await userEvent.click(page.getByRole('button', { name: 'Conversations' }));

    await expect.element(page.getByRole('button', { name: /Earlier about the queue/ })).toBeVisible();
  });

  it('⌘J toggles the rail', async () => {
    localStorage.setItem(COLLAPSE_KEY, '0');
    await render(wrap(<ChatDock agents={AGENTS} scopeLabel="Everything" />));

    await expect.element(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();

    await userEvent.keyboard('{Meta>}j{/Meta}');

    await expect.element(page.getByRole('button', { name: 'Open the conversation (⌘J)' })).toBeVisible();
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe('1');

    await userEvent.keyboard('{Meta>}j{/Meta}');

    await expect.element(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();
  });

  it('without a scope it is the everything conversation, collapsed by default when the page says so', async () => {
    await render(wrap(<ChatDock agents={AGENTS} scopeLabel="Everything" pageContext={{ path: '/dashboard/review', title: 'Review' }} defaultCollapsed />));

    await expect.element(page.getByRole('button', { name: 'Open the conversation (⌘J)' })).toBeVisible();
    expect(page.getByRole('complementary').elements()).toHaveLength(0);
    // Not scoped: the global pointer, never the per-record lookup.
    expect(vi.mocked(client.conversations.latestForScope)).not.toHaveBeenCalled();

    await userEvent.click(page.getByRole('button', { name: 'Open the conversation (⌘J)' }));

    await expect.element(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();
    await expect.element(page.getByText('Chat', { exact: true })).toBeVisible();
  });

  it('a stored choice wins over the page default, in both directions', async () => {
    localStorage.setItem(COLLAPSE_KEY, '0');
    await render(wrap(<ChatDock agents={AGENTS} scopeLabel="Everything" defaultCollapsed />));

    await expect.element(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();
  });

  it('sends where the person is with each turn when unscoped, and never when scoped', async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('', { status: 500 });
    }));
    try {
      await render(wrap(<ChatDock agents={AGENTS} scopeLabel="Everything" pageContext={{ path: '/dashboard/review', title: 'Review' }} defaultCollapsed={false} />));
      await userEvent.fill(page.getByRole('textbox'), 'what is waiting?');
      await userEvent.keyboard('{Enter}');

      await expect.poll(() => calls.length).toBe(1);

      expect(calls[0]).toMatchObject({ message: 'what is waiting?', page_context: { path: '/dashboard/review', title: 'Review' } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a record page is full width on arrival: collapsed to the edge tab, one ⌘J away', async () => {
    await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" />));

    await expect.element(page.getByTestId('rail-edge-tab')).toBeVisible();
    expect(page.getByRole('complementary').elements()).toHaveLength(0);

    await userEvent.keyboard('{Meta>}j{/Meta}');

    await expect.element(page.getByRole('complementary', { name: 'Conversation about Rowan Pike' })).toBeVisible();
  });

  it('a decision waiting is the exception — the rail opens, because the decision is inside it', async () => {
    await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" run={RUN} />));

    await expect.element(page.getByRole('complementary', { name: 'Conversation about Rowan Pike' })).toBeVisible();
  });

  it('overlays the page rather than narrowing it, in the viewport\'s own frame', async () => {
    await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" defaultCollapsed={false} />));

    const aside = (await page.getByRole('complementary', { name: 'Conversation about Rowan Pike' }).element()) as HTMLElement;

    // Portalled out of whatever mounted it, and fixed to the viewport: the
    // page beside it keeps its full width, and the composer cannot drift
    // below the fold because a page gutter padded its containing block.
    // (The test environment loads no stylesheet, so the class list is the
    // assertable form of "fixed to the viewport".)
    expect(aside.parentElement).toBe(document.body);
    expect(aside.className).toContain('fixed');
    expect(aside.className).toContain('right-0');
    expect(aside.className).not.toContain('sticky');
    expect(aside.className).not.toContain('shrink-0');
  });

  it('a `@change` tag routes the ask to the draft rewrite, with the send the anchor named', async () => {
    const rewriteDraft = vi.fn(async () => ({ body: 'a shorter draft one body' }));
    // @ts-expect-error — the mocked client is shaped per test.
    client.review = { rewriteDraft, actionStatus: vi.fn(async () => ({ status: 'pending', decidedBy: null, decidedAt: null })) };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    try {
      await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" run={RUN} />));
      // The selection control arms the tag through the one entry function.
      requestAgentSurface({ tags: [{ type: 'intent', id: 'change', label: 'Change the draft' }] });

      await expect.element(page.getByTestId('composer-tag')).toBeVisible();

      await userEvent.fill(page.getByRole('textbox'), 'this opener is too long');
      await userEvent.keyboard('{Enter}');

      await vi.waitFor(() => expect(rewriteDraft).toHaveBeenCalled());

      expect(rewriteDraft).toHaveBeenCalledWith({ runId: 42, hint: 'this opener is too long', contentId: 'send-1' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('without the tag the same words are a question — nothing is rewritten', async () => {
    const rewriteDraft = vi.fn();
    // @ts-expect-error — the mocked client is shaped per test.
    client.review = { rewriteDraft, actionStatus: vi.fn(async () => ({ status: 'pending', decidedBy: null, decidedAt: null })) };
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('', { status: 500 });
    }));
    try {
      await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" run={RUN} />));
      await userEvent.fill(page.getByRole('textbox'), 'why is this opener like that?');
      await userEvent.keyboard('{Enter}');

      await expect.poll(() => calls.length).toBe(1);

      expect(rewriteDraft).not.toHaveBeenCalled();
      expect(calls[0]).toMatchObject({ message: 'why is this opener like that?' });
      // An intent tag is not a record: it never travels as one.
      expect(calls[0]).not.toHaveProperty('context_refs');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('says an empty workspace is a state, with the next step, and never sends the sentinel', async () => {
    const searchOnly = [{ slug: '__search__', name: 'Search only', icon: 'search' as const, placeholder: 'Search…' }];
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response('', { status: 500 });
    }));
    try {
      await render(wrap(<ChatDock agents={searchOnly} scopeLabel="Everything" defaultCollapsed={false} />));

      await expect.element(page.getByTestId('no-agents-state')).toBeVisible();
      await expect.element(page.getByRole('link', { name: /Teams & agents/ })).toBeVisible();

      // The composer stays live, and the answer is the same sentence.
      await userEvent.fill(page.getByRole('textbox'), 'what should I do?');
      await userEvent.keyboard('{Enter}');

      await expect.element(page.getByText(/This workspace has no agents yet/)).toBeVisible();
      expect(calls.filter(u => u.includes('/rpc/agent/stream'))).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders nothing when there are no agents', async () => {
    await render(wrap(<ChatDock agents={[]} scopeRef={SCOPE} scopeLabel="Rowan Pike" />));

    await expect.element(page.getByRole('complementary')).not.toBeInTheDocument();
  });

  it('opens with the scope as the header title and no underlined link under it', async () => {
    await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" defaultCollapsed={false} />));

    await expect.element(page.getByRole('complementary', { name: 'Conversation about Rowan Pike' })).toBeInTheDocument();
    await expect.element(page.getByText('Rowan Pike')).toBeInTheDocument();
    // The back-to-everything link left the header on 2026-09-15 — it read as
    // an error and cost the header a second line. It is a row in the ⋯ menu.
    await expect.element(page.getByRole('link', { name: 'All conversations' })).not.toBeInTheDocument();
  });

  it('keeps the autonomy rung inside the (+) menu — the bar is (+), the gauge, send', async () => {
    await render(wrap(<ChatDock agents={AGENTS} scopeLabel="Everything" defaultCollapsed={false} />));

    expect(page.getByTestId('autonomy-chip').elements()).toHaveLength(0);

    await userEvent.click(page.getByTestId('composer-attach'));

    await expect.element(page.getByRole('option', { name: /Done for you/ })).toBeVisible();
    await expect.element(page.getByRole('option', { name: /Ask first/ })).toBeVisible();
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

    await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" defaultCollapsed={false} />));

    await expect.element(page.getByText('The entrance path sets it.')).toBeInTheDocument();
    expect(vi.mocked(client.conversations.latestForScope)).toHaveBeenCalledWith({ scopeRef: SCOPE });
    expect(vi.mocked(client.conversations.get)).toHaveBeenCalledWith({ id: 41 });
  });

  it('collapses to the reopen button and the choice persists', async () => {
    await render(wrap(<ChatDock agents={AGENTS} scopeRef={SCOPE} scopeLabel="Rowan Pike" defaultCollapsed={false} />));

    await userEvent.click(page.getByRole('button', { name: 'Collapse the conversation (⌘J)' }));

    await expect.element(page.getByRole('button', { name: 'Open the conversation (⌘J)' })).toBeInTheDocument();
    await expect.element(page.getByRole('complementary')).not.toBeInTheDocument();
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe('1');

    await userEvent.click(page.getByRole('button', { name: 'Open the conversation (⌘J)' }));

    await expect.element(page.getByRole('complementary', { name: 'Conversation about Rowan Pike' })).toBeInTheDocument();
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe('0');
  });
});

describe('ChatDock speaks as the workspace (§9.10)', () => {
  it('unscoped: the header says Chat — never the workspace name, never the lead agent — and the composer stays neutral', async () => {
    localStorage.setItem(COLLAPSE_KEY, '0');
    const agents = [{ ...AGENTS[0]!, workspaceName: 'Revenue' }];
    await render(wrap(<ChatDock agents={agents} scopeLabel="Everything" />));

    await expect.element(page.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask anything…');

    // "Chat" is the title; the sidebar already names the workspace, and the lead agent's name is nowhere.
    await expect.element(page.getByText('Chat', { exact: true })).toBeVisible();

    expect(page.getByText('RevOps Lead').query()).toBeNull();
    expect(page.getByText(/^Direct ·/).query()).toBeNull();
    expect(page.getByText('Message RevOps Lead', { exact: false }).query()).toBeNull();
  });

  it('scoped: titled by the record, with the workspace — not an agent — as who answers', async () => {
    const agents = [{ ...AGENTS[0]!, workspaceName: 'Revenue' }];
    await render(wrap(<ChatDock agents={agents} scopeRef={SCOPE} scopeLabel="Rowan Pike" defaultCollapsed={false} />));

    // The record names the sheet (title + sr description) and the header — several matches, all correct.
    await vi.waitFor(() => expect(page.getByText('Rowan Pike', { exact: true }).elements().length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(page.getByText('Revenue', { exact: true }).elements().length).toBeGreaterThan(0));

    expect(page.getByText('RevOps Lead').query()).toBeNull();
  });
});
