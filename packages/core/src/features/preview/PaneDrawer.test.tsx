import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { PaneDrawer, peekLabel } from './PaneDrawer';
import { closePreview, openPreview, rememberPreviewTitle, useOpenPreviewRef } from './previewState';
import '@/styles/global.css';

/**
 * ONE PANE UX ON A PHONE (Chris, 2026-10-23): "On mobile it should render as a
 * drawer and (when >=2) tabs", and "if 'open' but collapsed on mobile, I
 * should have a way to see that and expand the drawer". Fixtures are fictional.
 */

function Surface() {
  const open = useOpenPreviewRef();
  return (
    <div className="fixed inset-0 flex flex-col justify-end">
      <form><textarea data-agent-composer aria-label="Message" /></form>
      <PaneDrawer>{open ? <p data-testid="pane-body">{`${open.type}:${open.id}`}</p> : null}</PaneDrawer>
    </div>
  );
}

describe('the pane on a phone', () => {
  const start = window.location.href;

  beforeEach(async () => {
    window.history.replaceState(null, '', '/dashboard/chat');
    await page.viewport(390, 844);
    rememberPreviewTitle('artifact:12', 'Revenue chart');
    rememberPreviewTitle('object:16', 'Larkfield renewal');
  });

  afterEach(() => {
    closePreview();
    window.history.replaceState(null, '', start);
  });

  it('is a drawer with no tabs while one thing is open', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);

    await expect.element(page.getByTestId('preview-drawer')).toBeVisible();
    await expect.element(page.getByTestId('pane-body')).toHaveTextContent('artifact:12');

    expect(page.getByTestId('pane-tabs').elements()).toHaveLength(0);
  });

  it('shows a tab per entry once two are open, and a tab puts its entry on top', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);
    openPreview({ type: 'object', id: '16' }, null);

    await expect.element(page.getByTestId('pane-tabs')).toBeVisible();

    const tabs = page.getByRole('tab');

    await expect.element(tabs.nth(0)).toHaveTextContent('Revenue chart');
    await expect.element(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

    await tabs.nth(0).click();

    await expect.element(page.getByTestId('pane-body')).toHaveTextContent('artifact:12');
  });

  it('closes one entry with its tab\'s X, and the drawer goes with the last one', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);
    openPreview({ type: 'object', id: '16' }, null);

    await page.getByRole('button', { name: 'Close Larkfield renewal' }).click();

    await expect.element(page.getByTestId('pane-body')).toHaveTextContent('artifact:12');

    expect(page.getByTestId('pane-tabs').elements()).toHaveLength(0);

    closePreview();

    await expect.element(page.getByTestId('preview-drawer')).not.toBeInTheDocument();
  });

  it('folds to a bar above the composer that says what is open, and the bar unfolds it', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);
    openPreview({ type: 'object', id: '16' }, null);

    await page.getByTestId('pane-handle').click();

    const peek = page.getByTestId('pane-peek');

    await expect.element(peek).toHaveTextContent('Larkfield renewal · 2 open');
    expect(page.getByTestId('preview-drawer').elements()).toHaveLength(0);

    // Above the composer, never over it.
    const composer = document.querySelector('form')!.getBoundingClientRect();

    expect(peek.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(composer.top);

    await peek.click();

    await expect.element(page.getByTestId('preview-drawer')).toBeVisible();
    await expect.element(page.getByTestId('pane-body')).toHaveTextContent('object:16');
  });

  it('folds on a swipe down the handle', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);

    await expect.element(page.getByTestId('pane-handle')).toBeInTheDocument();

    const handle = page.getByTestId('pane-handle').element();
    const { x, y } = handle.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x + 5, clientY: y + 2 }));
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 5, clientY: y + 120 }));

    await expect.element(page.getByTestId('pane-peek')).toHaveTextContent('Revenue chart');
  });

  it('says the count only when more than one is open', () => {
    expect(peekLabel('Revenue chart', 1)).toBe('Revenue chart');
    expect(peekLabel('Revenue chart', 3)).toBe('Revenue chart · 3 open');
  });
});
