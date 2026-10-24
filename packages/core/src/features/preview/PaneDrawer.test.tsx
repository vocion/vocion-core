import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { FULL_GAP, snapHeights } from './drawerSnap';
import { PaneDrawer, peekLabel } from './PaneDrawer';
import { closePreview, openPreview, rememberPreviewTitle, setPaneCollapsed, useOpenPreviewRef } from './previewState';
import '@/styles/global.css';

/**
 * ONE PANE UX ON A PHONE (Chris, 2026-10-23): "On mobile it should render as a
 * drawer and (when >=2) tabs", and "if 'open' but collapsed on mobile, I
 * should have a way to see that and expand the drawer". And 2026-10-24: "I
 * can't drag drawer full height", "when closed I lose the drag handle that
 * opens it", "switching active drawer tab changes tab order". Fixtures are
 * fictional.
 */

function Surface({ tall = false }: { tall?: boolean }) {
  const open = useOpenPreviewRef();
  return (
    <div className="fixed inset-0 flex flex-col justify-end" data-testid="surface">
      <div data-testid="above-composer" />
      <form><textarea data-agent-composer aria-label="Message" /></form>
      <PaneDrawer>
        {open
          ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <p data-testid="pane-header">{`Header ${open.type}:${open.id}`}</p>
                <div data-testid="pane-body" className="min-h-0 flex-1 overflow-y-auto">
                  <p>{`${open.type}:${open.id}`}</p>
                  {tall && <div style={{ height: 3000 }} />}
                </div>
              </div>
            )
          : null}
      </PaneDrawer>
    </div>
  );
}

/**
 * A mouse drag from `el`'s middle, `dy` px down (negative is up), over `ms`:
 * an unhurried drag settles where it is let go; a short `ms` is a flick.
 * @param el
 * @param dy
 * @param ms
 * @param steps
 */
async function drag(el: Element, dy: number, ms = 360, steps = 6) {
  const { x, y, width, height } = el.getBoundingClientRect();
  const cx = x + width / 2;
  const cy = y + height / 2;
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerType: 'mouse', button: 0 }));
  for (let i = 1; i <= steps; i++) {
    await new Promise(r => setTimeout(r, ms / steps));
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy + (dy * i) / steps, pointerType: 'mouse' }));
  }
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy + dy, pointerType: 'mouse' }));
}

function drawerHeight(): number {
  return page.getByTestId('preview-drawer').element().getBoundingClientRect().height;
}

const tabNames = () => page.getByRole('tab').elements().map(e => e.textContent);

describe('the pane on a phone', () => {
  const start = window.location.href;

  beforeEach(async () => {
    window.history.replaceState(null, '', '/dashboard/chat');
    await page.viewport(390, 844);
    rememberPreviewTitle('artifact:12', 'Revenue chart');
    rememberPreviewTitle('object:16', 'Larkfield renewal');
    rememberPreviewTitle('artifact:21', 'Base case: the year ends near break-even on a long title');
    rememberPreviewTitle('artifact:22', 'Costs have outrun revenue since the summer, by a margin');
    rememberPreviewTitle('artifact:23', 'Cash runway at the current burn, month by month');
  });

  afterEach(() => {
    closePreview();
    window.history.replaceState(null, '', start);
  });

  it('is a drawer with no tabs while one thing is open, at half the screen', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);

    await expect.element(page.getByTestId('preview-drawer')).toBeVisible();
    await expect.element(page.getByTestId('pane-body')).toHaveTextContent('artifact:12');
    await expect.element(page.getByTestId('preview-drawer')).toHaveAttribute('data-drawer-snap', 'half');

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

  it('keeps the tabs in the order they opened when one is picked (2026-10-24)', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);
    openPreview({ type: 'object', id: '16' }, null);
    openPreview({ type: 'artifact', id: '21' }, null);

    await expect.element(page.getByRole('tab').nth(2)).toHaveAttribute('aria-selected', 'true');

    const before = tabNames();
    await page.getByRole('tab').nth(0).click();

    await expect.element(page.getByRole('tab').nth(0)).toHaveAttribute('aria-selected', 'true');

    expect(tabNames()).toEqual(before);

    await page.getByRole('tab').nth(1).click();

    await expect.element(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');

    expect(tabNames()).toEqual(before);
  });

  it('scrolls the picked tab into view rather than cutting it off', async () => {
    await render(<Surface />);
    for (const id of ['21', '22', '23']) {
      openPreview({ type: 'artifact', id }, null);
    }

    const strip = page.getByTestId('pane-tabs');

    await expect.element(page.getByRole('tab').nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => {
      const box = strip.element().getBoundingClientRect();
      const tab = page.getByRole('tab').nth(2).element().getBoundingClientRect();
      return tab.right <= box.right + 1 && tab.left >= box.left - 1;
    }).toBe(true);

    await page.getByRole('tab').nth(0).click();

    await expect.poll(() => {
      const box = strip.element().getBoundingClientRect();
      const tab = page.getByRole('tab').nth(0).element().getBoundingClientRect();
      return tab.left >= box.left - 1;
    }).toBe(true);
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

  it('a tap on the handle steps half → full → folded', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);

    await page.getByRole('button', { name: 'Expand the preview to full height' }).click();

    await expect.element(page.getByTestId('preview-drawer')).toHaveAttribute('data-drawer-snap', 'full');
    await expect.poll(drawerHeight).toBeGreaterThan(844 - FULL_GAP - 4);

    await page.getByRole('button', { name: 'Fold the preview' }).click();

    await expect.element(page.getByTestId('pane-peek')).toBeVisible();
  });

  it('drags to full height by the handle, and by the pane\'s header (2026-10-24)', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);

    await expect.element(page.getByTestId('pane-handle')).toBeInTheDocument();

    await drag(page.getByTestId('pane-handle').element(), -420);

    await expect.element(page.getByTestId('preview-drawer')).toHaveAttribute('data-drawer-snap', 'full');
    await expect.poll(drawerHeight).toBeGreaterThan(snapHeights(844).half + 100);

    await drag(page.getByTestId('pane-header').element(), 260);

    await expect.element(page.getByTestId('preview-drawer')).toHaveAttribute('data-drawer-snap', 'half');
  });

  it('at full height, content scrolls; a pull down from its top moves the drawer', async () => {
    await render(<Surface tall />);
    openPreview({ type: 'artifact', id: '12' }, null);
    await page.getByRole('button', { name: 'Expand the preview to full height' }).click();

    await expect.element(page.getByTestId('preview-drawer')).toHaveAttribute('data-drawer-snap', 'full');

    const body = page.getByTestId('pane-body').element() as HTMLElement;
    body.scrollTop = 400;
    await drag(body, 260);

    await expect.element(page.getByTestId('preview-drawer')).toHaveAttribute('data-drawer-snap', 'full');

    body.scrollTop = 0;
    await drag(body, 260);

    await expect.element(page.getByTestId('preview-drawer')).toHaveAttribute('data-drawer-snap', 'half');
  });

  it('folds to a bar with its own handle above the composer, and a tap on the bar opens it', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);
    openPreview({ type: 'object', id: '16' }, null);

    setPaneCollapsed(true);

    const peek = page.getByTestId('pane-peek');

    await expect.element(peek).toHaveTextContent('Larkfield renewal · 2 open');
    await expect.element(page.getByTestId('pane-peek-handle')).toBeInTheDocument();

    expect(page.getByTestId('preview-drawer').elements()).toHaveLength(0);

    // Above the composer, never over it.
    const composer = document.querySelector('form')!.getBoundingClientRect();

    expect(peek.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(composer.top);

    await peek.click();

    await expect.element(page.getByTestId('preview-drawer')).toBeVisible();
    await expect.element(page.getByTestId('pane-body')).toHaveTextContent('object:16');
  });

  it('opens from the bar on a drag up', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);
    setPaneCollapsed(true);

    await expect.element(page.getByTestId('pane-peek')).toBeVisible();

    // A flick up from the bar carries it to the top.
    await drag(page.getByTestId('pane-peek').element(), -300, 60);

    await expect.element(page.getByTestId('preview-drawer')).toHaveAttribute('data-drawer-snap', 'full');
  });

  it('keeps the bar above the composer when the composer moves without resizing (2026-10-24)', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);
    setPaneCollapsed(true);

    const peek = page.getByTestId('pane-peek');

    await expect.element(peek).toBeVisible();

    // A card docks above the composer: the composer moves up, its size the same.
    const spacer = page.getByTestId('above-composer').element() as HTMLElement;
    spacer.style.height = '220px';

    await expect.poll(() => peek.element().getBoundingClientRect().bottom <= document.querySelector('form')!.getBoundingClientRect().top).toBe(true);
    await expect.poll(() => peek.element().getBoundingClientRect().top >= 0).toBe(true);
  });

  it('folds on a swipe down the handle', async () => {
    await render(<Surface />);
    openPreview({ type: 'artifact', id: '12' }, null);

    await expect.element(page.getByTestId('pane-handle')).toBeInTheDocument();

    const handle = page.getByTestId('pane-handle').element();
    const { x, y } = handle.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x + 5, clientY: y + 2 }));
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 5, clientY: y + 420 }));

    await expect.element(page.getByTestId('pane-peek')).toHaveTextContent('Revenue chart');
  });

  it('says the count only when more than one is open', () => {
    expect(peekLabel('Revenue chart', 1)).toBe('Revenue chart');
    expect(peekLabel('Revenue chart', 3)).toBe('Revenue chart · 3 open');
  });
});
