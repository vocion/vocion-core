import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { ChatDropZone } from './ChatDropZone';

/**
 * The whole conversation pane is the drop target (founder, 2026-10-09: "chat
 * should have a much bigger file drop zone"). A real drag-and-drop from the
 * desktop is covered by the Playwright spec (e2e/attachments); this pins the
 * component's own rules.
 */

function drag(el: Element, type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', files: File[] = [], kinds: string[] = ['Files']) {
  const dt = new DataTransfer();
  for (const f of files) {
    dt.items.add(f);
  }
  if (!kinds.includes('Files')) {
    dt.setData('text/plain', 'a selection');
  }
  el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
}

function Pane({ onFiles }: { onFiles?: (files: File[]) => void }) {
  return (
    <ChatDropZone onFiles={onFiles} className="flex h-96 flex-col">
      <div data-testid="transcript" className="flex-1">A conversation</div>
      <textarea aria-label="Ask" />
    </ChatDropZone>
  );
}

describe('ChatDropZone', () => {
  it('shows "Drop to attach" over the whole pane while a file is held anywhere over it', async () => {
    await render(<Pane onFiles={() => {}} />);
    const transcript = page.getByTestId('transcript').element();

    expect(page.getByTestId('chat-drop-overlay').elements()).toHaveLength(0);

    drag(transcript, 'dragenter', [new File(['x'], 'leads.xlsx')]);

    await expect.element(page.getByTestId('chat-drop-overlay')).toHaveTextContent('Drop to attach');

    // Crossing into a child and back out of it is not leaving the pane.
    const box = page.getByRole('textbox').element();
    const held = [new File(['x'], 'leads.xlsx')];
    drag(box, 'dragenter', held);
    drag(transcript, 'dragleave', held);

    await expect.element(page.getByTestId('chat-drop-overlay')).toBeInTheDocument();

    drag(box, 'dragleave', held);

    await expect.element(page.getByTestId('chat-drop-overlay')).not.toBeInTheDocument();
  });

  it('hands every dropped file over and clears the overlay', async () => {
    const onFiles = vi.fn();
    await render(<Pane onFiles={onFiles} />);
    const transcript = page.getByTestId('transcript').element();
    const files = [new File(['a'], 'Export-All-Leads.xlsx'), new File(['b'], 'plan.docx')];

    drag(transcript, 'dragenter', files);
    drag(transcript, 'drop', files);

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]![0].map((f: File) => f.name)).toEqual(['Export-All-Leads.xlsx', 'plan.docx']);

    await expect.element(page.getByTestId('chat-drop-overlay')).not.toBeInTheDocument();
  });

  it('ignores a drag of text, and is inert where the surface cannot take files', async () => {
    const onFiles = vi.fn();
    const { rerender } = await render(<Pane onFiles={onFiles} />);
    drag(page.getByTestId('transcript').element(), 'dragenter', [], ['text/plain']);

    expect(page.getByTestId('chat-drop-overlay').elements()).toHaveLength(0);

    await rerender(<Pane />);
    drag(page.getByTestId('transcript').element(), 'dragenter', [new File(['x'], 'a.pdf')]);

    expect(page.getByTestId('chat-drop-overlay').elements()).toHaveLength(0);
  });
});
