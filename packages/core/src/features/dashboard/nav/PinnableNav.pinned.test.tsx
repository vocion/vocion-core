import type { PinnableItem } from './navPins';
import { FileText, FolderLock, MessageSquare } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { SidebarProvider } from '@/components/ui/sidebar';
import { PinnableNav } from './PinnableNav';

vi.mock('@/libs/I18nNavigation', () => ({
  usePathname: () => '/dashboard',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));

/**
 * THE PINNED SECTION (founder, 2026-10-09: "Pin artifacts/wikis/chats/data
 * rooms to favorites … that show up in my sidebar"): each row its kind's icon
 * and its title on one line, the whole title on hover; about eight, then
 * More…; unpin from a hover × or the row's ⋯; reorder by drag or, without a
 * mouse, Alt+↑/↓ and the ⋯'s Move up / Move down.
 */

const object = (n: number, icon = FileText): PinnableItem => ({ title: `Northwind pinned doc ${n}`, url: `/dashboard/artifacts/${n}`, pinKey: `pin:artifact:${n}`, icon, origin: 'object' });

function renderPinned(items: PinnableItem[], spies = { toggle: vi.fn(), move: vi.fn() }) {
  render(
    <SidebarProvider>
      <PinnableNav
        label="Pinned"
        items={items}
        pins={items.map(i => i.pinKey ?? i.url)}
        onTogglePin={spies.toggle}
        onMovePin={spies.move}
        max={8}
        reorderable
        moreLabel="More…"
        pinLabel="Pin"
        unpinLabel="Unpin"
        moveUpLabel="Move up"
        moveDownLabel="Move down"
        rowMenuLabel="Pinned item options"
      />
    </SidebarProvider>,
  );
  return spies;
}

describe('the Pinned section', () => {
  it('shows each pin by title with its full title on hover, and no pin icons by default', async () => {
    const long = { ...object(1, MessageSquare), title: 'Kestrel Capital renewal — the whole thread about the Q4 pricing change and the counter-offer' };
    renderPinned([long, object(2, FolderLock)]);

    const link = page.getByRole('link', { name: /Kestrel Capital renewal/ });

    await expect.element(link).toBeVisible();
    await expect.element(link).toHaveAttribute('title', long.title);
    await expect.element(link).toHaveAttribute('href', long.url);
    // The row's controls wait for hover or focus.
    await expect.element(page.getByTestId('pinned-row-remove').first()).not.toBeVisible();
  });

  it('shows eight, then More… holds the rest', async () => {
    renderPinned(Array.from({ length: 11 }, (_, i) => object(i + 1)));

    await expect.element(page.getByRole('link', { name: 'Northwind pinned doc 8', exact: true })).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Northwind pinned doc 9', exact: true })).not.toBeInTheDocument();

    await page.getByRole('button', { name: 'More…' }).click();

    await expect.element(page.getByRole('menu').getByText('Northwind pinned doc 11')).toBeVisible();
  });

  it('unpins from the hover ×', async () => {
    const { toggle } = renderPinned([object(1), object(2)]);

    await page.getByRole('link', { name: 'Northwind pinned doc 2', exact: true }).hover();
    await page.getByRole('button', { name: 'Unpin: Northwind pinned doc 2' }).click();

    expect(toggle).toHaveBeenCalledWith('pin:artifact:2');
  });

  it('reorders without a mouse: Alt+↓ on a focused row, and Move up in its ⋯', async () => {
    const { move, toggle } = renderPinned([object(1), object(2), object(3)]);

    (document.querySelector('a[href="/dashboard/artifacts/1"]') as HTMLElement).focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(move).toHaveBeenCalledWith('pin:artifact:1', 1);

    await page.getByRole('link', { name: 'Northwind pinned doc 3', exact: true }).hover();
    await page.getByRole('button', { name: 'Pinned item options: Northwind pinned doc 3' }).click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();

    expect(move).toHaveBeenCalledWith('pin:artifact:3', 1);

    await page.getByRole('link', { name: 'Northwind pinned doc 3', exact: true }).hover();
    await page.getByRole('button', { name: 'Pinned item options: Northwind pinned doc 3' }).click();
    await page.getByRole('menuitem', { name: 'Unpin' }).click();

    expect(toggle).toHaveBeenCalledWith('pin:artifact:3');
  });
});
