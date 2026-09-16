import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { ChatComposer } from './ChatComposer';
import { UserMessage } from './UserMessage';

const LONG_PASTE = 'From: client@example.com\n'.repeat(40); // ~1000 chars

function pasteInto(el: Element, text: string) {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}

describe('ChatComposer pasted chip', () => {
  it('a large paste becomes a chip instead of flooding the box', async () => {
    const onPasteText = vi.fn();
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} onPasteText={onPasteText} />,
    );

    const textarea = page.getByRole('textbox');
    pasteInto(await textarea.element(), LONG_PASTE);

    expect(onPasteText).toHaveBeenCalledWith(LONG_PASTE);
  });

  it('a short paste stays a normal paste', async () => {
    const onPasteText = vi.fn();
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} onPasteText={onPasteText} />,
    );

    pasteInto(await page.getByRole('textbox').element(), 'just a sentence');

    expect(onPasteText).not.toHaveBeenCalled();
  });

  it('the chip renders with the PASTED tag and its remove control clears it', async () => {
    const onClearPasted = vi.fn();
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} pastedText={LONG_PASTE} onClearPasted={onClearPasted} />,
    );

    await expect.element(page.getByText('Pasted')).toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: 'Remove pasted content' }));

    expect(onClearPasted).toHaveBeenCalled();
  });

  it('pasted content alone arms the send button', async () => {
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} pastedText={LONG_PASTE} />,
    );

    await expect.element(page.getByRole('button', { name: 'Send message' })).not.toBeDisabled();
  });
});

describe('UserMessage clamp', () => {
  it('long content clamps behind Show more and expands on demand', async () => {
    const content = `please review this\n${'x'.repeat(700)}END_MARKER`;
    await render(<UserMessage content={content} />);

    await expect.element(page.getByText('END_MARKER', { exact: false })).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: 'Show more' }));

    await expect.element(page.getByText('END_MARKER', { exact: false })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it('short content renders without a control', async () => {
    await render(<UserMessage content="why day 6?" />);

    await expect.element(page.getByText('why day 6?')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });
});

describe('ChatComposer slash command hint (§9.10)', () => {
  it('shows the mode pill the parent names while a /search command is armed', async () => {
    await render(
      <ChatComposer value="/search MSA unsigned" onChange={() => {}} onSubmit={() => {}} commandHint="Search only — retrieval, no model in the loop" />,
    );

    await expect.element(page.getByTestId('command-hint')).toHaveTextContent('Search only');
  });

  it('shows no pill for an ordinary message', async () => {
    await render(<ChatComposer value="how is the quarter?" onChange={() => {}} onSubmit={() => {}} />);

    expect(page.getByTestId('command-hint').query()).toBeNull();
  });
});

describe('ChatComposer never locks while a turn streams', () => {
  it('the box stays enabled for the whole turn', async () => {
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} streaming onStop={() => {}} />,
    );

    await expect.element(page.getByRole('textbox')).not.toBeDisabled();
  });

  it('shows the queue placeholder so the affordance is discoverable', async () => {
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} streaming onStop={() => {}} />,
    );

    await expect.element(page.getByPlaceholder('Queue a message… ⌘⏎ to send now')).toBeInTheDocument();
  });

  it('Enter queues instead of sending, and never kills the running turn', async () => {
    const onQueue = vi.fn();
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    await render(
      <ChatComposer
        value="and skip the closed ones"
        onChange={() => {}}
        onSubmit={onSubmit}
        streaming
        onStop={onStop}
        onQueue={onQueue}
      />,
    );

    await page.getByRole('textbox').click();
    await userEvent.keyboard('{Enter}');

    expect(onQueue).toHaveBeenCalledWith('and skip the closed ones');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('⌘⏎ jumps the queue — stop the turn and send now', async () => {
    const onQueue = vi.fn();
    const onSendNow = vi.fn();
    await render(
      <ChatComposer
        value="actually stop"
        onChange={() => {}}
        onSubmit={() => {}}
        streaming
        onStop={() => {}}
        onQueue={onQueue}
        onSendNow={onSendNow}
      />,
    );

    await page.getByRole('textbox').click();
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');

    expect(onSendNow).toHaveBeenCalledWith('actually stop');
    expect(onQueue).not.toHaveBeenCalled();
  });

  it('Esc on an empty box stops the turn; Esc with text in it does not', async () => {
    const onStop = vi.fn();
    const screen = await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} streaming onStop={onStop} />,
    );

    await page.getByRole('textbox').click();
    await userEvent.keyboard('{Escape}');

    expect(onStop).toHaveBeenCalledTimes(1);

    screen.rerender(
      <ChatComposer value="half a thought" onChange={() => {}} onSubmit={() => {}} streaming onStop={onStop} />,
    );
    await page.getByRole('textbox').click();
    await userEvent.keyboard('{Escape}');

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('Enter still sends normally when nothing is streaming', async () => {
    const onSubmit = vi.fn();
    const onQueue = vi.fn();
    await render(
      <ChatComposer value="how is the quarter?" onChange={() => {}} onSubmit={onSubmit} onQueue={onQueue} />,
    );

    await page.getByRole('textbox').click();
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalled();
    expect(onQueue).not.toHaveBeenCalled();
  });
});

describe('ChatComposer queued rows', () => {
  const three = [
    { id: 'a', text: 'first', at: 1 },
    { id: 'b', text: 'second', at: 2 },
    { id: 'c', text: 'third', at: 3 },
  ];

  it('renders one compact row per queued message, in order', async () => {
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} streaming onStop={() => {}} queued={three} />,
    );

    const rows = page.getByTestId('queued-row').elements();

    expect(rows.map(r => r.textContent)).toEqual(['first', 'second', 'third']);
  });

  it('the ✕ drops just that row', async () => {
    const onDropQueued = vi.fn();
    await render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        streaming
        onStop={() => {}}
        queued={three}
        onDropQueued={onDropQueued}
      />,
    );

    await userEvent.click(page.getByRole('button', { name: 'Remove queued message: second' }));

    expect(onDropQueued).toHaveBeenCalledWith('b');
  });

  it('clicking a row pulls it back for an edit', async () => {
    const onEditQueued = vi.fn();
    await render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        streaming
        onStop={() => {}}
        queued={three}
        onEditQueued={onEditQueued}
      />,
    );

    await userEvent.click(page.getByRole('button', { name: 'Edit queued message: third' }));

    expect(onEditQueued).toHaveBeenCalledWith('c');
  });

  it('caps the visible rows so a phone keeps its viewport, and expands on demand', async () => {
    const five = [...three, { id: 'd', text: 'fourth', at: 4 }, { id: 'e', text: 'fifth', at: 5 }];
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} streaming onStop={() => {}} queued={five} />,
    );

    expect(page.getByTestId('queued-row').elements()).toHaveLength(3);

    await userEvent.click(page.getByRole('button', { name: '+2 more' }));

    expect(page.getByTestId('queued-row').elements()).toHaveLength(5);
  });

  it('says so when a stopped or failed turn left the queue unsent', async () => {
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} queued={three} queueHeld onDismissHeld={() => {}} />,
    );

    await expect.element(page.getByTestId('queue-held')).toHaveTextContent('were not sent');
  });
});
