import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

/**
 * The chat surface's two panes and the line between them — the layout half of
 * `ConversationArtifactView`, rendered on its own so the assertions are about
 * geometry rather than about an SSE transcript.
 *
 * The browser project loads no stylesheet, so a Tailwind-sized element (the
 * 8px divider) measures zero and the driver will not click it. Presence, the
 * ARIA values and what is remembered are what is asserted, and the pointer
 * events the divider needs are dispatched at it — `toBeVisible` would be
 * failing on layout these tests are not about.
 */

const { ConversationSplit } = await import('./ConversationSplit');
const { clampConversationSplit, readStoredConversationSplit, SPLIT_STEP } = await import('./splitState');

const CONVERSATION = <div data-testid="conversation">The transcript</div>;
const PANE = <div data-testid="pane">The document</div>;

function forget() {
  try {
    localStorage.removeItem('vocion_conversation_split');
  } catch {
    /* ignore */
  }
}

const valueOf = (el: Element) => Number(el.getAttribute('aria-valuenow'));

describe('a conversation with a document beside it', () => {
  it('renders both panes, with a divider between them', async () => {
    forget();
    render(<ConversationSplit conversation={CONVERSATION} pane={PANE} />);

    await expect.element(page.getByTestId('conversation')).toBeVisible();
    await expect.element(page.getByTestId('pane')).toBeVisible();
    await expect.element(page.getByTestId('conversation-divider')).toBeInTheDocument();
  });

  it('fills the window rather than a reading column', async () => {
    forget();
    render(<ConversationSplit conversation={CONVERSATION} pane={PANE} />);

    const split = page.getByTestId('conversation-divider');

    await expect.element(split).toBeInTheDocument();

    const host = document.querySelector('[data-conversation-split="open"]') as HTMLElement;

    // No cap of its own: whatever the shell gave it, it uses.
    expect(host.className).not.toContain('max-w-');
    expect(host.getBoundingClientRect().width).toBeGreaterThan(1000);
  });

  it('moves the split with the keyboard and remembers where it was left', async () => {
    forget();
    render(<ConversationSplit conversation={CONVERSATION} pane={PANE} />);
    const divider = page.getByTestId('conversation-divider');

    await expect.element(divider).toBeInTheDocument();

    const before = valueOf(divider.element());
    (divider.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');

    await expect.element(divider).toHaveAttribute('aria-valuenow', String(before + Math.round(SPLIT_STEP * 100)));
    expect(readStoredConversationSplit()).toBeCloseTo((before + SPLIT_STEP * 100) / 100, 2);
  });

  it('hands the split back to the default on a double-click', async () => {
    forget();
    render(<ConversationSplit conversation={CONVERSATION} pane={PANE} />);
    const divider = page.getByTestId('conversation-divider');

    await expect.element(divider).toBeInTheDocument();

    const before = valueOf(divider.element());
    (divider.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');

    await expect.element(divider).toHaveAttribute('aria-valuenow', String(before + 2));

    // Dispatched rather than driven: with no stylesheet the 8px divider
    // measures zero, and the driver refuses to click an element it cannot see.
    divider.element().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    await expect.element(divider).toHaveAttribute('aria-valuenow', String(before));
    expect(readStoredConversationSplit()).toBeNull();
  });

  it('cannot be dragged into a sliver', async () => {
    forget();
    render(<ConversationSplit conversation={CONVERSATION} pane={PANE} />);
    const divider = page.getByTestId('conversation-divider');

    await expect.element(divider).toBeInTheDocument();

    (divider.element() as HTMLElement).focus();
    for (let i = 0; i < 60; i++) {
      await userEvent.keyboard('{ArrowRight}');
    }

    const stopped = valueOf(divider.element());

    expect(stopped).toBe(Number(divider.element().getAttribute('aria-valuemax')));
    // The document pane still has room to be a document.
    expect(stopped).toBeLessThan(100);
  });

  it('opens at a split neither pane can complain about', async () => {
    forget();
    render(<ConversationSplit conversation={CONVERSATION} pane={PANE} />);
    const divider = page.getByTestId('conversation-divider');

    await expect.element(divider).toBeInTheDocument();

    const host = document.querySelector('[data-conversation-split="open"]') as HTMLElement;
    const usable = host.getBoundingClientRect().width - 8 - 32;
    const now = valueOf(divider.element()) / 100;

    expect(now).toBeCloseTo(clampConversationSplit(now, usable), 2);
  });

  it('adopts the split this browser was left at', async () => {
    forget();
    localStorage.setItem('vocion_conversation_split', '0.600');

    render(<ConversationSplit conversation={CONVERSATION} pane={PANE} />);

    await expect.element(page.getByTestId('conversation-divider')).toHaveAttribute('aria-valuenow', '60');

    forget();
  });

  it('ignores a corrupt stored split rather than failing to lay out', async () => {
    forget();
    localStorage.setItem('vocion_conversation_split', 'not-a-number');

    render(<ConversationSplit conversation={CONVERSATION} pane={PANE} />);
    const divider = page.getByTestId('conversation-divider');

    await expect.element(divider).toBeInTheDocument();

    expect(valueOf(divider.element())).toBeGreaterThan(20);
    expect(valueOf(divider.element())).toBeLessThan(80);

    forget();
  });
});

describe('a conversation with nothing beside it', () => {
  it('keeps the reading column, and offers no divider to drag', async () => {
    forget();
    render(<ConversationSplit conversation={CONVERSATION} pane={null} />);

    await expect.element(page.getByTestId('conversation')).toBeVisible();
    expect(page.getByTestId('conversation-divider').elements()).toHaveLength(0);
    expect(page.getByTestId('pane').elements()).toHaveLength(0);

    const host = document.querySelector('[data-conversation-split="closed"]') as HTMLElement;

    expect(host.className).toContain('max-w-[1180px]');
    expect(host.className).toContain('mx-auto');
  });
});

describe('the divider is not offered where there is no split', () => {
  it('is hidden below the desktop breakpoint', async () => {
    forget();
    render(<ConversationSplit conversation={CONVERSATION} pane={PANE} />);
    const divider = page.getByTestId('conversation-divider');

    await expect.element(divider).toBeInTheDocument();

    // The panes stack below `lg`, and `hidden` takes the control out of the
    // accessibility tree with them rather than leaving one that moves nothing.
    expect(divider.element().className).toContain('hidden');
    expect(divider.element().className).toContain('lg:block');
  });
});
