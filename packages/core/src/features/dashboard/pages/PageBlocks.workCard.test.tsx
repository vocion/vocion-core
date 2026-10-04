import type { PageField, PageRow } from '@/libs/workspace/pages';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * The Work card on a phone (Chris, 2026-10-04, FE-441 at 390 px): the drawing
 * is a banner across the top, not a sliver down the side of a card the height
 * of the screen; the state leads the first row of chips; a sentence sits on a
 * row of its own; and no dot is ever left trailing with nothing after it.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { PageBlocks } = await import('./PageBlocks');

function field(over: Partial<PageField> & Pick<PageField, 'key'>): PageField {
  return { label: over.key, format: 'text', total: false, priority: 1, hideWhenConstant: false, hideWhenEmpty: true, detail: false, ...over } as PageField;
}

/** As templates/plugins/software-factory/pages/work.yaml declares them. */
const FIELDS: PageField[] = [
  field({ key: 'title', from: 'name' }),
  field({ key: 'visual', from: 'meta.visual', format: 'image' }),
  field({ key: 'status', from: 'meta.state', format: 'badge', toneFrom: 'meta.stateTone' }),
  field({ key: 'now', from: 'meta.now', format: 'live' }),
  field({ key: 'summary', from: 'meta.problem' }),
  field({ key: 'detail', from: 'meta.workLine' }),
  field({ key: 'cost', from: 'meta.costLine', format: 'mono' }),
  field({ key: 'product', from: 'meta.product' }),
];
const PRIMARY = { field: 'title', thumb: 'visual', subtitle: ['status', 'now', 'summary', 'detail', 'cost', 'product'] };
const NOW = new Date('2026-10-04T19:00:00Z');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const ROW: PageRow = {
  id: 441,
  code: 'FE-441',
  title: 'Select several library documents and act on them at once',
  status: null,
  createdAt: NOW,
  meta: {
    name: 'Select several library documents and act on them at once',
    visual: PNG,
    state: 'In QA',
    stateTone: 'info',
    now: { line: 'QA reviewing PR #199 · 3 min', live: true, href: null },
    problem: 'Select several documents in the library and star, archive or copy all their share links in one move, with Undo.',
    workLine: 'QA is reviewing the pull request. No action needed from you · today',
    costLine: '$6.16 so far',
    product: 'StampSend',
  },
} as PageRow;

function mount(width: number) {
  return render(
    <div style={{ width }}>
      <PageBlocks rows={[ROW]} fields={FIELDS} primary={PRIMARY} now={NOW.getTime()} rowLink="/dashboard/p/feature/{id}" />
    </div>,
  );
}

describe('the Work card on a phone', () => {
  it('draws the picture as a banner across the top, the words under it', async () => {
    mount(390);

    await expect.element(page.getByTestId('block-thumb')).toBeVisible();

    const thumb = document.querySelector('[data-testid="block-thumb"]')!.getBoundingClientRect();
    const title = document.querySelector('[data-testid="block-title-link"], h2, .font-semibold')!.getBoundingClientRect();

    expect(thumb.width).toBeGreaterThan(300);
    expect(thumb.height).toBeLessThan(130);
    expect(title.top).toBeGreaterThanOrEqual(thumb.bottom - 1);
  });

  it('leads the first row with the state, joins chips with a dot, and gives each sentence a row with no dot after it', async () => {
    mount(390);

    await expect.element(page.getByTestId('block-thumb')).toBeVisible();

    const lines = [...document.querySelectorAll('[data-testid="block-line"]')].map(l => l.textContent?.replace(/\s*·\s*/g, ' · ').replace(/\s+/g, ' ').trim() ?? '');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^In QA · QA reviewing PR #199 · 3 min/);

    for (const line of lines) {
      expect(line.endsWith('·')).toBe(false);
    }
    const prose = [...document.querySelectorAll('[data-testid="block-prose"]')].map(p => p.textContent?.trim());

    expect(prose).toEqual([
      'Select several documents in the library and star, archive or copy all their share links in one move, with Undo.',
      'QA is reviewing the pull request. No action needed from you · today',
    ]);

    // The dot after a sentence used to float at the right edge of its middle line.
    for (const p of document.querySelectorAll('[data-testid="block-prose"]')) {
      expect(p.nextElementSibling?.textContent?.trim().startsWith('·')).toBe(false);
      expect(p.textContent?.trim().endsWith('·')).toBe(false);
    }

    expect(lines[0]).toContain('$6.16 so far · StampSend');
  });
});

describe('the Work card on a desk', () => {
  it('keeps the drawing as a full-height strip on the left edge, the state at the top right', async () => {
    mount(900);

    await expect.element(page.getByTestId('block-thumb')).toBeVisible();

    const thumb = document.querySelector('[data-testid="block-thumb"]')!.getBoundingClientRect();
    const card = document.querySelector('[data-testid="block-thumb"]')!.closest('a, [data-testid="block-card"]')!.getBoundingClientRect();

    expect(thumb.width).toBeLessThan(130);
    expect(thumb.height).toBeGreaterThan(card.height - 4);

    // On a desk the state does not lead the chip row; it sits beside the headline.
    const firstLine = document.querySelector('[data-testid="block-line"]')!;
    const hiddenBadges = [...firstLine.querySelectorAll('.\\@md\\:hidden')].filter(e => getComputedStyle(e).display === 'none');

    expect(hiddenBadges.length).toBeGreaterThan(0);
  });
});
