import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { closePreview, openPreview, previewBack, stackAfterOpen, stackAfterUrl, useOpenPreviewRef, usePreviewStack } from './previewState';

/**
 * THE PANE STACKS WHAT YOU OPEN (Chris, 2026-10-23: the thread's background
 * work opened a second side surface beside a record already open in the pane;
 * "our standard sidebar panes, that can stack if needed").
 */

describe('the stack, as pure steps', () => {
  it('puts what was showing underneath what opens, and never twice', () => {
    expect(stackAfterOpen([], null, 'object:16')).toEqual([]);
    expect(stackAfterOpen([], 'object:16', 'conversation:12.work')).toEqual(['object:16']);
    expect(stackAfterOpen(['object:16'], 'conversation:12.work', 'worker_run:9')).toEqual(['object:16', 'conversation:12.work']);
    // Reopening what is underneath lifts it rather than leaving a copy below.
    expect(stackAfterOpen(['object:16', 'conversation:12.work'], 'worker_run:9', 'object:16')).toEqual(['conversation:12.work', 'worker_run:9']);
    // The same preview again changes nothing.
    expect(stackAfterOpen(['object:16'], 'conversation:12.work', 'conversation:12.work')).toEqual(['object:16']);
  });

  it('comes off as the URL walks back down it, and empties on close', () => {
    const stack = ['object:16', 'conversation:12.work'];

    expect(stackAfterUrl(stack, 'worker_run:9')).toBe(stack);
    expect(stackAfterUrl(stack, 'conversation:12.work')).toEqual(['object:16']);
    expect(stackAfterUrl(stack, 'object:16')).toEqual([]);
    expect(stackAfterUrl(stack, null)).toEqual([]);
  });
});

function Probe() {
  const open = useOpenPreviewRef();
  const stack = usePreviewStack();
  return (
    <div>
      <p data-testid="open">{open ? `${open.type}:${open.id}` : 'none'}</p>
      <p data-testid="stack">{stack.join(',') || 'empty'}</p>
      <button type="button" onClick={previewBack}>back</button>
    </div>
  );
}

describe('the stack in the URL', () => {
  const start = window.location.href;

  beforeEach(() => {
    window.history.replaceState(null, '', '/dashboard/chat');
  });

  afterEach(() => {
    window.history.replaceState(null, '', start);
  });

  it('opens a second preview on top of the first, and the back control returns to it', async () => {
    await render(<Probe />);
    openPreview({ type: 'object', id: '16' }, null);
    openPreview({ type: 'conversation', id: '12.work' }, null);

    await expect.element(page.getByTestId('open')).toHaveTextContent('conversation:12.work');
    await expect.element(page.getByTestId('stack')).toHaveTextContent('object:16');

    await userEvent.click(page.getByRole('button', { name: 'back' }));

    await expect.element(page.getByTestId('open')).toHaveTextContent('object:16');
    await expect.element(page.getByTestId('stack')).toHaveTextContent('empty');
  });

  it('closes the whole pane, not one layer', async () => {
    await render(<Probe />);
    openPreview({ type: 'object', id: '16' }, null);
    openPreview({ type: 'conversation', id: '12.work' }, null);
    closePreview();

    await expect.element(page.getByTestId('open')).toHaveTextContent('none');
    await expect.element(page.getByTestId('stack')).toHaveTextContent('empty');
  });

  it('the browser\'s Back walks the same stack', async () => {
    await render(<Probe />);
    openPreview({ type: 'object', id: '16' }, null);
    openPreview({ type: 'conversation', id: '12.work' }, null);
    window.history.back();

    await expect.element(page.getByTestId('open')).toHaveTextContent('object:16');
    await expect.element(page.getByTestId('stack')).toHaveTextContent('empty');
  });
});
