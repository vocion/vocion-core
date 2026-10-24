import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { closePreview, closePreviewEntry, openPreview, previewBack, replacePreview, setPaneCollapsed, stackAfterClose, stackAfterOpen, stackAfterUrl, tabsInOrder, useOpenPreviewRef, usePaneCollapsed, usePreviewStack } from './previewState';

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

  it('closing the top shows what was under it; closing one underneath only takes it out (2026-10-23)', () => {
    const stack = ['object:16', 'artifact:12'];

    expect(stackAfterClose(stack, 'worker_run:9', 'worker_run:9')).toEqual({ stack: ['object:16'], current: 'artifact:12' });
    expect(stackAfterClose(stack, 'worker_run:9', 'object:16')).toEqual({ stack: ['artifact:12'], current: 'worker_run:9' });
    expect(stackAfterClose([], 'artifact:12', 'artifact:12')).toEqual({ stack: [], current: null });
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
  const folded = usePaneCollapsed();
  return (
    <div>
      <p data-testid="open">{open ? `${open.type}:${open.id}` : 'none'}</p>
      <p data-testid="stack">{stack.join(',') || 'empty'}</p>
      <p data-testid="folded">{folded ? 'folded' : 'open'}</p>
      <button type="button" onClick={previewBack}>back</button>
    </div>
  );
}

describe('the tabs\' order (2026-10-24: picking a tab moved it)', () => {
  it('keeps the order entries opened in, whichever is on top', () => {
    // The stack puts what is on top last; the tabs do not follow it.
    expect(tabsInOrder(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
    expect(tabsInOrder(['a', 'b', 'c'], ['a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('drops what closed and appends what it never saw, once', () => {
    expect(tabsInOrder(['a', 'b', 'c'], ['c', 'a'])).toEqual(['a', 'c']);
    expect(tabsInOrder(['a'], ['a', 'z', 'z'])).toEqual(['a', 'z']);
  });
});

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

  it('closes one entry at a time: the top gives way to what was under it, and the last closes the pane', async () => {
    await render(<Probe />);
    openPreview({ type: 'object', id: '16' }, null);
    openPreview({ type: 'artifact', id: '12' }, null);
    openPreview({ type: 'worker_run', id: '9' }, null);
    closePreviewEntry('object:16');

    await expect.element(page.getByTestId('open')).toHaveTextContent('worker_run:9');
    await expect.element(page.getByTestId('stack')).toHaveTextContent('artifact:12');

    closePreviewEntry('worker_run:9');

    await expect.element(page.getByTestId('open')).toHaveTextContent('artifact:12');
    await expect.element(page.getByTestId('stack')).toHaveTextContent('empty');

    closePreviewEntry('artifact:12');

    await expect.element(page.getByTestId('open')).toHaveTextContent('none');
  });

  it('folding keeps everything open, and anything newly opened unfolds it', async () => {
    await render(<Probe />);
    openPreview({ type: 'artifact', id: '12' }, null);
    setPaneCollapsed(true);

    await expect.element(page.getByTestId('folded')).toHaveTextContent('folded');
    await expect.element(page.getByTestId('open')).toHaveTextContent('artifact:12');

    openPreview({ type: 'object', id: '16' }, null);

    await expect.element(page.getByTestId('folded')).toHaveTextContent('open');
  });

  it('a page that arrives showing something opens it in place, and drops the old ?artifact= it replaces', async () => {
    window.history.replaceState(null, '', '/dashboard/chat/7?artifact=12');
    await render(<Probe />);
    replacePreview({ type: 'artifact', id: '12' }, ['artifact']);

    await expect.element(page.getByTestId('open')).toHaveTextContent('artifact:12');

    expect(window.location.search).toBe('?preview=artifact%3A12');
  });
});
