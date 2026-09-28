import type { PageField, PageRow } from '@/libs/workspace/pages';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * The picture on a Work card, in a real browser.
 *
 * What is asserted is where the picture sits and what happens to the card
 * that has none — the two things the grid is read by. The drawing itself is
 * argued with in `libs/factory/proposalVisual.test.ts`; what it looks like is
 * not this file's business.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}));
// The card is the app's `<Link>` (workspace-prefixed, prefetched); the test
// only needs an anchor with the href.
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { PageBlocks } = await import('./PageBlocks');

function field(over: Partial<PageField> & Pick<PageField, 'key'>): PageField {
  return { label: over.key, format: 'text', total: false, priority: 1, hideWhenConstant: false, hideWhenEmpty: true, ...over } as PageField;
}

const FIELDS: PageField[] = [
  field({ key: 'title', label: 'Outcome' }),
  field({ key: 'visual', label: 'Preview', from: 'meta.visual', format: 'image' }),
  field({ key: 'kindIcon', label: 'Kind', from: 'meta.kindIcon', format: 'icon' }),
  field({ key: 'status', label: 'Status', from: 'meta.state', format: 'badge' }),
  field({ key: 'why', label: 'Why', from: 'meta.whyLine' }),
];

const PRIMARY = { field: 'title', thumb: 'visual', thumbFallback: 'kindIcon', subtitle: ['status', 'why'] };

const DRAWN: PageRow = {
  id: 1,
  title: 'Send has no admin panel',
  status: null,
  createdAt: null,
  meta: { visual: '/api/artifacts/o-a/o-a.svg', state: 'Decide', whyLine: 'a person asked for it' },
};

const UNDRAWN: PageRow = {
  id: 2,
  title: 'An admin cannot set somebody up before they sign up',
  status: null,
  createdAt: null,
  meta: { state: 'Not triaged', whyLine: 'it removes manual toil', kindIcon: 'puzzle' },
};

async function board(rows: PageRow[], primary: typeof PRIMARY | { field: string; subtitle: string[] } = PRIMARY) {
  render(
    <div className="mx-auto max-w-[1200px] p-6">
      <PageBlocks rows={rows} fields={FIELDS} primary={primary} rowLink="/dashboard/p/feature/{id}" now={Date.now()} />
    </div>,
  );

  await expect.element(page.getByText(rows[0]!.title)).toBeInTheDocument();
}

/**
 * The outcome's headline.
 * @param title - The outcome.
 */
function titleEl(title: string): HTMLElement {
  return [...document.querySelectorAll('span')].find(el => el.textContent === title) as HTMLElement;
}

/**
 * Where the headline starts, measured from its own card's left edge.
 * @param title
 */
function titleBox(title: string): DOMRect {
  return titleEl(title).getBoundingClientRect();
}

/**
 * How far in from its own card the headline starts. Measured against the card
 * rather than the viewport, because the blocks sit in a two-column grid and
 * the right-hand column starts several hundred pixels further over.
 * @param title - The outcome.
 */
function titleInset(title: string): number {
  const el = titleEl(title);
  const card = el.closest('a')!;

  return Math.round(el.getBoundingClientRect().left - card.getBoundingClientRect().left);
}

describe('the picture on a Work card', () => {
  it('draws the picture, and does not label it', async () => {
    // "PREVIEW" above a thumbnail is a caption saying what a person can
    // already see, which is what the fact list would have made of it.
    await board([DRAWN]);

    expect(document.querySelector('img')?.getAttribute('src')).toBe('/api/artifacts/o-a/o-a.svg');
    expect(document.body.textContent).not.toContain('Preview');
  });

  it('keeps the words beside the picture, not under it', async () => {
    // A thumbnail above the headline pushes every title down by its own
    // height, and a column of titles that do not start at the same place is a
    // column nobody can scan.
    await board([DRAWN]);

    expect(document.querySelector('img')!.getBoundingClientRect().right)
      .toBeLessThanOrEqual(titleBox(DRAWN.title).left);
  });

  it('leaves the slot empty on a row that has no picture yet', async () => {
    await board([UNDRAWN]);

    expect(document.querySelector('img')).toBeNull();
    // The row still says everything it has to say.
    expect(document.body.textContent).toContain('it removes manual toil');
  });

  it('starts every card\'s words at the same edge, drawn or not — a mark stands in for the picture, never an empty frame', async () => {
    await board([DRAWN, UNDRAWN]);

    expect(titleInset(DRAWN.title)).toBe(titleInset(UNDRAWN.title));
    expect(document.querySelectorAll('[data-testid="block-thumb"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="block-mark"]')).toHaveLength(1);
    expect(document.querySelector('.border-dashed')).toBeNull();
  });

  it('reads as an ordinary labelled fact on a page that declared no thumb', async () => {
    // `format: image` still draws an image; `primary.thumb` is what decides
    // that this one LEADS. A page that wants a picture in its fact list — an
    // avatar in a column — keeps getting one.
    await board([DRAWN], { field: 'title', subtitle: ['status', 'why'] });

    expect(document.querySelector('img')).not.toBeNull();
    expect(document.body.textContent).toContain('Preview');
    expect(document.querySelector('img')!.getBoundingClientRect().top)
      .toBeGreaterThan(titleBox(DRAWN.title).top);
  });

  it('never scrolls sideways on a phone, picture and all', async () => {
    await page.viewport(390, 844);
    await board([DRAWN, UNDRAWN]);

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });
});
