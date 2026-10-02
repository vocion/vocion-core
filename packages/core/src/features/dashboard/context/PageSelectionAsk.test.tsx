import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: { anchoredComments: { list: vi.fn(async () => []), create: vi.fn(), apply: vi.fn(), delete: vi.fn() } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  usePathname: () => '/dashboard/p/releases/7',
  useRouter: () => ({ push: vi.fn() }),
}));

const { PageSelectionAsk } = await import('./PageSelectionAsk');
const { AskAboutThis } = await import('./AskAboutThis');
const { CommentLayerProvider } = await import('@/features/comments/CommentLayer');

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

/**
 * Select an element's words as a text range — what a drag produces, and what
 * the comment layer anchors on — then release the mouse.
 * @param id - The element.
 */
async function selectWords(id: string) {
  const text = document.getElementById(id)!.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, text.length);
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

  it('a commentable page shows one toolbar — the same shape — never the shell\'s beside it', async () => {
    await render(
      <>
        <div data-page-content>
          <p id="outside-layer" data-comment-field="Loose">A region no comment layer holds keeps the page-wide Ask.</p>
          <CommentLayerProvider targetRef="review:9" changeIntent record={{ type: 'object', id: 'contacts:9', label: 'A lead' }}>
            <div data-comment-field="Recommended angle"><p id="in-layer">The angle rests on two sourced facts.</p></div>
          </CommentLayerProvider>
        </div>
        <PageSelectionAsk />
      </>,
    );

    await selectWords('in-layer');

    // The layer's toolbar, and only it: one Ask, its Change, one toolbar.
    await expect.element(page.getByRole('button', { name: 'Change', exact: true })).toBeVisible();

    expect(page.getByRole('toolbar', { name: 'Selected passage' }).elements()).toHaveLength(1);
    expect(page.getByRole('button', { name: 'Ask', exact: true }).elements()).toHaveLength(1);
    expect(document.querySelector('[data-comment-popover] [data-selection-toolbar]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await selectWords('outside-layer');

    // Outside the layer's container the shell's toolbar still answers.
    await vi.waitFor(() => expect(document.querySelector('[data-comment-popover]')).toBeNull());

    await expect.element(page.getByRole('button', { name: 'Ask', exact: true })).toBeVisible();
  });
});
