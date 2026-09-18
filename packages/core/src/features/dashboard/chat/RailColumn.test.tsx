import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

/**
 * One column, two stacked panes. The contract Chris asked for: opening a
 * preview while chat is open SPLITS the column rather than replacing chat,
 * either pane closes on its own, and the divider moves and is remembered.
 * Fixture data only.
 *
 * The browser project loads no stylesheet, so a Tailwind-sized element (the
 * 8px divider) measures zero and `toBeVisible` would fail on layout this test
 * is not about. Presence and the ARIA values are what is asserted of it.
 */

vi.mock('@/libs/Orpc', () => ({
  client: {
    preview: {
      get: vi.fn(async (i: { id: string }) => ({
        ref: { type: 'document', id: i.id },
        title: 'Platform kickoff',
        sourceLabel: 'Granola',
        body: 'Fixture transcript.',
        href: '/dashboard/search/42',
      })),
    },
  },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { RailColumn } = await import('./RailColumn');
const { openPreview, closePreview } = await import('@/features/preview/previewState');
const { RAIL_SPLIT_DEFAULT, readStoredRailSplit } = await import('./railState');

const CHAT = <div data-testid="chat-pane">The conversation</div>;
const REF = { type: 'document' as const, id: 'granola:fixture' };

function Column(props: { chat: React.ReactNode | null; narrow?: boolean }) {
  return <RailColumn priority="dock" chat={props.chat} narrow={props.narrow} width={420} aria-label="Rail" closed={<div data-testid="edge-tab">Chat</div>} />;
}

/**
 * The dock's own open/closed state, so a test can close the chat pane.
 * @param props
 * @param props.narrow
 */
function Harness(props: { narrow?: boolean }) {
  const [chatOpen, setChatOpen] = useState(true);
  return (
    <>
      <button type="button" data-testid="close-chat" onClick={() => setChatOpen(false)}>Close chat</button>
      <Column chat={chatOpen ? CHAT : null} narrow={props.narrow} />
    </>
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
  try {
    localStorage.removeItem('vocion_rail_split');
  } catch {
    /* ignore */
  }
});

describe('the right column', () => {
  it('is only the chat pane until a preview opens', async () => {
    render(<Column chat={CHAT} />);

    await expect.element(page.getByTestId('chat-pane')).toBeVisible();
    expect(page.getByTestId('preview-panel').elements()).toHaveLength(0);
    expect(page.getByTestId('rail-divider').elements()).toHaveLength(0);
  });

  it('splits rather than replacing chat when a preview opens', async () => {
    render(<Column chat={CHAT} />);

    openPreview(REF, null);

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();
    await expect.element(page.getByTestId('chat-pane')).toBeVisible();
    await expect.element(page.getByTestId('rail-divider')).toBeInTheDocument();
    // One column, not two panels.
    expect(page.getByTestId('agent-rail').elements()).toHaveLength(1);
  });

  it('gives the column back to chat when the preview closes', async () => {
    render(<Column chat={CHAT} />);
    openPreview(REF, null);

    await expect.element(page.getByTestId('rail-divider')).toBeInTheDocument();

    closePreview();

    await expect.element(page.getByTestId('preview-panel')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('chat-pane')).toBeVisible();
    expect(page.getByTestId('rail-divider').elements()).toHaveLength(0);
  });

  it('leaves the preview full height when chat is closed', async () => {
    render(<Harness />);
    openPreview(REF, null);

    await expect.element(page.getByTestId('rail-divider')).toBeInTheDocument();

    await page.getByTestId('close-chat').click();

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();
    expect(page.getByTestId('chat-pane').elements()).toHaveLength(0);
    expect(page.getByTestId('rail-divider').elements()).toHaveLength(0);
  });

  it('shows the edge tab only when both panes are closed', async () => {
    render(<Harness />);
    await page.getByTestId('close-chat').click();

    await expect.element(page.getByTestId('edge-tab')).toBeVisible();

    openPreview(REF, null);

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();
    expect(page.getByTestId('edge-tab').elements()).toHaveLength(0);

    closePreview();

    await expect.element(page.getByTestId('edge-tab')).toBeVisible();
  });

  it('moves the divider with the keyboard and remembers where it was left', async () => {
    render(<Column chat={CHAT} />);
    openPreview(REF, null);
    const divider = page.getByTestId('rail-divider');

    await expect.element(divider).toBeInTheDocument();
    await expect.element(divider).toHaveAttribute('aria-valuenow', String(Math.round(RAIL_SPLIT_DEFAULT * 100)));

    (divider.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}');

    await expect.element(divider).toHaveAttribute('aria-valuenow', '55');
    expect(readStoredRailSplit()).toBeCloseTo(0.55, 2);
  });

  it('cannot be dragged into uselessness', async () => {
    render(<Column chat={CHAT} />);
    openPreview(REF, null);
    const divider = page.getByTestId('rail-divider');

    await expect.element(divider).toBeInTheDocument();

    (divider.element() as HTMLElement).focus();

    for (let i = 0; i < 20; i++) {
      await userEvent.keyboard('{ArrowUp}');
    }

    await expect.element(divider).toHaveAttribute('aria-valuenow', '20');
  });

  it('shows one pane at a time on a small screen, with a way back', async () => {
    render(<Column chat={CHAT} narrow />);
    openPreview(REF, null);

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();
    expect(page.getByTestId('chat-pane').elements()).toHaveLength(0);
    expect(page.getByTestId('rail-divider').elements()).toHaveLength(0);
    await expect.element(page.getByTestId('preview-close')).toHaveAttribute('aria-label', 'Back to chat');
  });
});

describe('getting back to the conversation', () => {
  it('offers a way to open chat when the preview holds the column alone', async () => {
    const opened: boolean[] = [];
    window.addEventListener('vocion:rail-set', (e) => {
      opened.push(Boolean((e as CustomEvent<{ open?: boolean }>).detail?.open));
    }, { once: true });
    render(<Harness />);
    await page.getByTestId('close-chat').click();
    openPreview(REF, null);

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();

    await page.getByTestId('rail-open-chat').click();

    expect(opened).toEqual([true]);
  });

  it('does not offer it where no rail is mounted to open', async () => {
    render(<RailColumn priority="preview" chat={null} width={420} aria-label="Preview" />);
    openPreview(REF, null);

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();
    expect(page.getByTestId('rail-open-chat').elements()).toHaveLength(0);
  });
});
