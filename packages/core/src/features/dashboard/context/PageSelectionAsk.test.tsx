import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

vi.mock('@/libs/I18nNavigation', () => ({
  usePathname: () => '/dashboard/p/releases/7',
  useRouter: () => ({ push: vi.fn() }),
}));

const { PageSelectionAsk } = await import('./PageSelectionAsk');
const { AskAboutThis } = await import('./AskAboutThis');

/**
 * Select an element's text the way a person does, then release the mouse.
 * @param id - The element.
 */
async function select(id: string) {
  const el = document.getElementById(id)!;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
}

describe('select to ask, on every page', () => {
  it('offers Ask on any page text, and yields to a region with its own toolbar', async () => {
    await render(
      <>
        <div data-page-content>
          <p id="plain">Allow founders to export a spreadsheet of every named viewer.</p>
          <div id="own"><p id="owned">The request body, which has its own Ask and Change.</p></div>
        </div>
        <textarea id="typing" defaultValue="Words someone is typing into a field." />
        <PageSelectionAsk />
        <AskAboutThis record={{ type: 'object', id: '130' }} selectionRoot="#own" variant="none" changeable />
      </>,
    );

    await select('plain');

    // The page's own watcher: Ask, and no Change on a page that declares no record.
    await expect.element(page.getByRole('button', { name: 'Ask' })).toBeVisible();

    expect(page.getByRole('button', { name: 'Change' }).elements()).toHaveLength(0);

    await select('owned');

    // One toolbar, the region's: exactly one Ask and its Change.
    await expect.element(page.getByRole('button', { name: 'Change' })).toBeVisible();

    expect(page.getByRole('button', { name: 'Ask' }).elements()).toHaveLength(1);
  });
});
