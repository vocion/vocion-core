import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

/**
 * A previewing list's half of the contract: the plain click previews, every
 * "take me there" gesture still navigates, the selection lives in the URL,
 * and `j`/`k` walk the rows with the preview following. Fixture data only.
 */

const navigated: string[] = [];

const doc = (id: string) => ({
  ref: { type: 'document', id },
  title: `Fixture document ${id}`,
  sourceLabel: 'Granola',
  body: 'Fixture body.',
  href: `/dashboard/search/${id}`,
});

vi.mock('@/libs/Orpc', () => ({ client: { preview: { get: vi.fn(async (i: { id: string }) => doc(i.id)) } } }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: (href: string) => navigated.push(href) }),
  usePathname: () => '/dashboard/search',
}));

const { ListRow, ListRows } = await import('@/components/patterns');
const { PreviewPanel } = await import('./PreviewPanel');
const { usePreviewList } = await import('./usePreviewList');

const IDS = ['11', '22', '33'];

function Harness() {
  const items = IDS.map(id => ({ ref: { type: 'document' as const, id }, href: `/dashboard/search/${id}` }));
  const preview = usePreviewList(items, href => navigated.push(href));
  return (
    // A meta-click on a real anchor navigates the harness's own iframe, which
    // tears down the browser runner's connection to it ("Cannot connect to the
    // iframe"). The contract under test is that the row stays a real link and
    // that the modified click does NOT preview — not that the browser performs
    // the navigation. So the navigation is recorded and prevented here, the way
    // a router would take it over.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      onClick={(e) => {
        const anchor = (e.target as HTMLElement).closest('a');
        if (anchor && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
          e.preventDefault();
          navigated.push(anchor.getAttribute('href') ?? '');
        }
      }}
    >
      <ListRows>
        {IDS.map((id, i) => (
          <ListRow
            key={id}
            data-testid="row"
            href={`/dashboard/search/${id}`}
            onSelect={() => preview.select(i)}
            selected={preview.selected === i}
            title={`Fixture document ${id}`}
          />
        ))}
      </ListRows>
      <PreviewPanel />
    </div>
  );
}

beforeEach(() => {
  navigated.length = 0;
  window.history.replaceState(null, '', '/?q=fixture');
});

describe('a list whose rows are references', () => {
  it('previews on a plain click instead of navigating', async () => {
    render(<Harness />);

    await page.getByTestId('row').nth(1).click();

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Fixture document 22');
    expect(navigated).toEqual([]);
  });

  it('still navigates on a meta-click, because the row is a real link', async () => {
    render(<Harness />);
    const row = page.getByTestId('row').nth(0);

    await expect.element(row).toHaveAttribute('href', '/dashboard/search/11');

    await row.click({ modifiers: ['Meta'] });

    await expect.element(page.getByTestId('preview-panel')).not.toBeInTheDocument();
    expect(navigated).toEqual(['/dashboard/search/11']);
  });

  it('puts the selection in the URL without losing the list state', async () => {
    render(<Harness />);

    await page.getByTestId('row').nth(2).click();

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();

    const params = new URLSearchParams(window.location.search);

    expect(params.get('preview')).toBe('document:33');
    expect(params.get('q')).toBe('fixture');
  });

  it('opens with a preview already showing when the URL says so', async () => {
    window.history.replaceState(null, '', '/?q=fixture&preview=document%3A22');
    render(<Harness />);

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Fixture document 22');
  });

  it('walks the rows with j and k, the preview following', async () => {
    render(<Harness />);

    await userEvent.keyboard('j');

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Fixture document 11');

    await userEvent.keyboard('j');

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Fixture document 22');

    await userEvent.keyboard('k');

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Fixture document 11');
  });

  it('opens the detail page on Enter', async () => {
    render(<Harness />);
    await page.getByTestId('row').nth(0).click();

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();

    await userEvent.keyboard('{Enter}');

    expect(navigated).toEqual(['/dashboard/search/11']);
  });

  it('marks the row the preview is showing', async () => {
    render(<Harness />);

    await page.getByTestId('row').nth(1).click();

    await expect.element(page.getByTestId('row').nth(1)).toHaveAttribute('aria-current', 'true');
  });
});
