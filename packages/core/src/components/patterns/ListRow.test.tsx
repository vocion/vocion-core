import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

/**
 * The row's one structural rule: **the link covers the record; anything that
 * clicks through to somewhere else sits beside it.**
 *
 * An anchor inside an anchor is not a style question. The browser's parser
 * closes the outer link where the inner one opens, so the DOM it builds is
 * not the DOM React rendered and hydration fails on the mismatch — which is
 * what `/gtm/proposals` did (`<a> cannot be a descendant of <a>`, 2026-09-19)
 * when the document chip went into `columns`. `columnsAside` is where a
 * column that links belongs, and this file is what would have caught it.
 *
 * Fixtures are fictional.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { Column, ListRow, ListRows } = await import('./index');

// Held in consts so the lint rule that wants `<Link />` for a known page route
// does not fire on a fixture: the chip under test IS a plain anchor, which is
// the whole point of where it may be rendered.
const ROOM = '/dashboard/rooms/7';
const DOCUMENT = '/dashboard/artifacts/41';
const PLAIN = '/dashboard/rooms/9';

function ProposalRow({ aside }: { aside: boolean }) {
  const cols = (
    <>
      <Column kind="status">
        <a href={DOCUMENT} data-proposal-document>12 sheets · verified</a>
      </Column>
      <Column kind="number">3</Column>
    </>
  );
  return (
    <ListRows>
      <ListRow
        data-testid="row"
        href={ROOM}
        title="Kestrel Capital — platform rebuild"
        chip="Drafting"
        columns={aside ? undefined : cols}
        columnsAside={aside ? cols : undefined}
        actions={<button type="button">Draft</button>}
      />
    </ListRows>
  );
}

describe('a column that links somewhere of its own', () => {
  it('sits beside the row link, so no anchor is nested in an anchor', async () => {
    const { container } = await render(<ProposalRow aside />);

    expect(container.querySelectorAll('a a')).toHaveLength(0);
    expect(container.querySelectorAll('a button')).toHaveLength(0);

    const chip = container.querySelector('[data-proposal-document]') as HTMLAnchorElement;

    expect(chip.tagName).toBe('A');
    expect(chip.getAttribute('href')).toBe(DOCUMENT);
    // Outside the row's own link — that is the whole point.
    expect(chip.closest(`a[href="${ROOM}"]`)).toBeNull();
    await expect.element(page.getByText('12 sheets · verified')).toBeVisible();
  });

  it('keeps the list reading columns then chip, on either side of the boundary', async () => {
    const { container } = await render(<ProposalRow aside />);
    const row = container.querySelector('[data-testid="row"]')!;
    const order = [...row.querySelectorAll('[data-column], .shrink-0')]
      .filter(el => el.hasAttribute('data-column') || el.textContent === 'Drafting')
      .map(el => el.getAttribute('data-column') ?? 'chip');

    expect(order).toEqual(['status', 'number', 'chip']);
  });

  it('the same columns in `columns` nest, and React says so — which is why this slot exists', async () => {
    // React's own complaint is the assertion; it is silenced here so the one
    // test that provokes it on purpose does not read like a broken suite.
    const complaints: string[] = [];
    const quiet = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void complaints.push(args.map(String).join(' ')));
    try {
      const { container } = await render(<ProposalRow aside={false} />);

      expect(container.querySelectorAll('a a').length).toBeGreaterThan(0);
      expect(complaints.join('\n')).toContain('cannot be a descendant of');
    } finally {
      quiet.mockRestore();
    }
  });
});

describe('a row of plain facts is unchanged', () => {
  it('keeps its columns and chip inside the link, so the whole row is one click target', async () => {
    const { container } = await render(
      <ListRows>
        <ListRow data-testid="plain" href={PLAIN} title="Northwind Logistics — discovery" columns={<Column kind="number">4</Column>} chip="Sent" />
      </ListRows>,
    );
    const link = container.querySelector(`a[href="${PLAIN}"]`)!;

    expect(link.querySelector('[data-column="number"]')).not.toBeNull();
    expect(link.textContent).toContain('Sent');
    expect(container.querySelectorAll('a a')).toHaveLength(0);
  });

  it('a row with actions still keeps the verbs outside the link', async () => {
    const { container } = await render(
      <ListRows>
        <ListRow href={PLAIN} title="Northwind Logistics — discovery" actions={<button type="button">Draft</button>} />
      </ListRows>,
    );

    expect(container.querySelectorAll('a button')).toHaveLength(0);
    expect(container.querySelector('[data-slot="row-actions"] button')).not.toBeNull();
  });
});
