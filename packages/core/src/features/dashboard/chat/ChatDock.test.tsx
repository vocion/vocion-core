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
const { ChatDock } = await import('./ChatDock');

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

describe('ChatDock', () => {
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
