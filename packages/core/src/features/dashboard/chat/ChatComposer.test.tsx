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

/**
 * `@artifact` and the `(+)` menu.
 *
 * The first cut of the deliverable contract was an icon chip beside send that
 * a classifier pre-armed from the draft. Chris killed it: an opt-in you have
 * to notice and undo is worse than one you ask for. What replaced it is a tag
 * on the composer's EXISTING `@`-mention — so there is one interaction here,
 * not two — and a `(+)` that types that tag into the box for people who would
 * rather point than remember the word.
 *
 * Two things matter: the tag must reach `onAddTag` as an ordinary chip, and
 * none of it may touch the send path. The queue and interrupt behaviour (#352)
 * is the composer's hardest-won contract, and a new control beside the box is
 * exactly how that kind of thing gets broken.
 */
const ARTIFACT_TAG_REF = { type: 'deliverable' as const, id: 'artifact', label: 'Artifact' };
const PAGE_TAG_REF = { type: 'page' as const, id: '/dashboard/deals/12', label: 'Acme renewal' };
// Stable identity: `tagSearch` is an effect dependency, and an inline arrow
// would re-resolve the popover on every render.
const TAG_SEARCH = async (q: string) =>
  [ARTIFACT_TAG_REF, PAGE_TAG_REF].filter(r => r.label.toLowerCase().includes(q.toLowerCase()));

describe('ChatComposer @artifact and the (+) menu', () => {
  it('has no (+) unless the surface offers something, so a bare composer is unchanged', async () => {
    await render(<ChatComposer value="" onChange={() => {}} onSubmit={() => {}} />);

    expect(page.getByTestId('composer-attach').elements()).toHaveLength(0);
  });

  it('lists what can be pulled into the turn, with the tag each one types', async () => {
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} attachable={[ARTIFACT_TAG_REF, PAGE_TAG_REF]} />,
    );

    await userEvent.click(page.getByTestId('composer-attach'));

    const items = page.getByTestId('composer-attach-item');

    await expect.element(items.nth(0)).toHaveTextContent('Artifact');
    await expect.element(items.nth(0)).toHaveTextContent('@artifact');
    await expect.element(items.nth(1)).toHaveTextContent('Acme renewal');
    await expect.element(items.nth(1)).toHaveTextContent('@page');
  });

  it('injects the tag into the text at the caret — no hidden state, no new event', async () => {
    const onChange = vi.fn();
    await render(
      <ChatComposer value="summarise this" onChange={onChange} onSubmit={() => {}} attachable={[ARTIFACT_TAG_REF]} />,
    );

    // Caret between "summarise" and " this".
    const box = page.getByRole('textbox').element() as HTMLTextAreaElement;
    box.setSelectionRange(9, 9);
    box.dispatchEvent(new Event('select', { bubbles: true }));

    await userEvent.click(page.getByTestId('composer-attach'));
    await userEvent.click(page.getByTestId('composer-attach-item').first());

    expect(onChange).toHaveBeenCalledWith('summarise @artifact this');
  });

  it('offers the tag in the same popover `@` opens, and picking it makes the same chip', async () => {
    const onAddTag = vi.fn();
    const onChange = vi.fn();
    await render(
      <ChatComposer
        value="@artifa"
        onChange={onChange}
        onSubmit={() => {}}
        onAddTag={onAddTag}
        tagSearch={TAG_SEARCH}
      />,
    );

    // Listed in the same listbox `@team` uses, and picked the same way.
    await expect.element(page.getByRole('listbox', { name: 'Tag a record' })).toBeInTheDocument();
    await expect.element(page.getByRole('option', { name: /Artifact/ })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(page.getByRole('textbox'));
    await userEvent.keyboard('{Enter}');

    expect(onAddTag).toHaveBeenCalledWith(ARTIFACT_TAG_REF);
    // The mention never reaches the model as text — the chip carries it, the
    // way every other ref does.
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('renders a picked tag as the same chip every other ref gets', async () => {
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} tags={[ARTIFACT_TAG_REF]} onRemoveTag={() => {}} />,
    );

    await expect.element(page.getByTestId('composer-tag')).toHaveTextContent('Artifact');
  });

  it('leaves Enter-sends alone with the tag on (#352)', async () => {
    const onSubmit = vi.fn();
    await render(
      <ChatComposer
        value="ship it"
        onChange={() => {}}
        onSubmit={onSubmit}
        tags={[ARTIFACT_TAG_REF]}
        attachable={[ARTIFACT_TAG_REF]}
      />,
    );

    await userEvent.click(page.getByRole('textbox'));
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('leaves Enter-queues-mid-turn alone with the tag on, and never disables the box (#352)', async () => {
    const onSubmit = vi.fn();
    const onQueue = vi.fn();
    await render(
      <ChatComposer
        value="and skip the closed ones"
        onChange={() => {}}
        onSubmit={onSubmit}
        streaming
        onQueue={onQueue}
        onStop={() => {}}
        tags={[ARTIFACT_TAG_REF]}
        attachable={[ARTIFACT_TAG_REF]}
      />,
    );

    await expect.element(page.getByRole('textbox')).toBeEnabled();

    await userEvent.click(page.getByRole('textbox'));
    await userEvent.keyboard('{Enter}');

    expect(onQueue).toHaveBeenCalledWith('and skip the closed ones');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('one alignment rule above the box (2026-09-16)', () => {
  it('renders the surface\'s own stack inside the composer column, so it shares the box\'s left edge', async () => {
    const screen = await render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        above={<div data-testid="about-chip">About: a briefing</div>}
        tags={[{ type: 'intent', id: 'change', label: 'Change the draft' }]}
      />,
    );
    const chip = screen.container.querySelector('[data-testid="about-chip"]')!;
    const tag = screen.container.querySelector('[data-testid="composer-tag"]')!;
    const form = screen.container.querySelector('form')!;
    const column = form.closest('.max-w-3xl')!;

    // One column owns the left edge; no child carries padding of its own.
    expect(column.contains(chip)).toBe(true);
    expect(column.contains(tag)).toBe(true);
    expect(chip.parentElement).toBe(column);
  });
});

describe('attachments — files in the next turn', () => {
  const shot = { id: 5, title: 'shot.png', contentType: 'image/png', bytes: 2048, url: '/api/artifacts/5', kind: 'image' as const };
  const deck = { id: 6, title: 'deck.pdf', contentType: 'application/pdf', bytes: 120_000, url: '/api/artifacts/6', kind: 'document' as const };

  it('shows each attached file as a chip, and the ✕ drops it', async () => {
    const onRemoveAttachment = vi.fn();
    await render(<ChatComposer value="" onChange={() => {}} onSubmit={() => {}} attachments={[shot, deck]} onAttachFiles={() => {}} onRemoveAttachment={onRemoveAttachment} />);

    expect(page.getByTestId('composer-attachment').elements()).toHaveLength(2);
    await expect.element(page.getByText('deck.pdf')).toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: 'Remove deck.pdf' }));

    expect(onRemoveAttachment).toHaveBeenCalledWith(6);
  });

  it('a message that is only a file can be sent; one still uploading cannot', async () => {
    const onSubmit = vi.fn();
    const { rerender } = await render(<ChatComposer value="" onChange={() => {}} onSubmit={onSubmit} attachments={[deck]} onAttachFiles={() => {}} />);

    await expect.element(page.getByRole('button', { name: 'Send message' })).toBeEnabled();

    await rerender(<ChatComposer value="" onChange={() => {}} onSubmit={onSubmit} attachments={[deck]} uploading onAttachFiles={() => {}} />);

    await expect.element(page.getByTestId('composer-uploading')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('the paperclip opens a file picker and hands the files over', async () => {
    const onAttachFiles = vi.fn();
    await render(<ChatComposer value="" onChange={() => {}} onSubmit={() => {}} onAttachFiles={onAttachFiles} />);

    await expect.element(page.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument();

    const input = page.getByTestId('composer-file-input');
    await input.upload(new File(['hello'], 'notes.txt', { type: 'text/plain' }));

    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    expect(onAttachFiles.mock.calls[0]![0][0].name).toBe('notes.txt');
  });

  it('says why a file was refused, above the box', async () => {
    await render(<ChatComposer value="" onChange={() => {}} onSubmit={() => {}} onAttachFiles={() => {}} attachError="model.xlsx: images, PDFs and text files can be attached." />);

    await expect.element(page.getByTestId('attach-error')).toHaveTextContent('model.xlsx');
  });

  it('has no paperclip when the surface cannot take files', async () => {
    await render(<ChatComposer value="" onChange={() => {}} onSubmit={() => {}} />);

    expect(page.getByRole('button', { name: 'Attach a file' }).elements()).toHaveLength(0);
  });
});
