import type { PageRow } from '@/libs/workspace/pageFields';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { buildProductOverview } from '@/libs/workspace/productOverview';
import '@/styles/global.css';

/**
 * A product's overview, drawn: the sections in the order a person running
 * the product asks, with the record's machinery behind a disclosure.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: () => {} }),
}));

const { ProductOverviewView } = await import('./ProductOverviewView');

const NOW = new Date('2026-09-24T12:00:00Z');

function row(id: number, title: string, meta: Record<string, unknown>): PageRow {
  return { id, title, status: 'active', createdAt: new Date('2026-09-20T00:00:00Z'), meta };
}

const SEND = row(2, 'Send', {
  slug: 'send',
  tagline: 'Send big files and know when they were opened',
  stage: 'dogfood',
  accountableUser: 'owner@northwind.example',
  urls: { app: 'https://app.northwind.example', site: 'https://northwind.example', api: 'https://api.northwind.example' },
  incumbent: { name: 'Kestrel Share', listPrice: '$45/user/month', checkedOn: '2026-09-19', sourceUrl: 'https://kestrel.example/pricing' },
  shippedThisMonth: 23,
});

async function draw(environments: PageRow[] = []) {
  const overview = buildProductOverview({
    environments,
    product: SEND,
    products: [SEND],
    requests: [
      row(10, 'Resume interrupted uploads', { product: 'send', state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build' }),
      row(11, 'Email delivery tracking', { product: 'send', state: 'building' }),
    ],
    releases: [row(20, 'Share button', { product: 'send', releasedAt: '2026-09-23T00:00:00Z' })],
    ownerName: 'Dana Reyes',
    links: { workSlug: 'work', requestLink: '/dashboard/p/feature/{id}', releasesSlug: 'releases', releaseLink: '/dashboard/objects/{id}' },
    now: NOW,
  });
  render(<ProductOverviewView overview={overview} page={{ slug: 'products', title: 'Products' }} now={NOW.getTime()} />);

  await expect.element(page.getByRole('heading', { name: 'Send', level: 1 })).toBeInTheDocument();
}

describe('the product overview', () => {
  it('is reached from Products and goes back to it, with no object furniture', async () => {
    await draw();
    const crumbs = document.querySelector('nav[aria-label="Breadcrumb"]')!;

    expect(crumbs.textContent).toBe('ProductsSend');
    expect(crumbs.querySelector('a')?.getAttribute('href')).toBe('/dashboard/p/products');
    expect(page.getByRole('link', { name: 'Back to Products' }).element().getAttribute('href')).toBe('/dashboard/p/products');

    const header = document.querySelector('[data-pattern="detail-header"]')!.textContent ?? '';

    expect(header).not.toContain('Objects');
    expect(header).not.toContain('Product · active');
    expect(header).not.toContain('#2');
    expect(header).toContain('Internal testing');
    expect(header).toContain('Owned by Dana Reyes');
  });

  it('draws the sections in the order a person asks them', async () => {
    await draw();
    const order = ['product-attention', 'product-focus', 'product-work', 'product-releases', 'product-performance', 'product-context', 'product-activity', 'product-technical'];
    const tops = order.map(id => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top);

    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  it('names the decision with a Review action, and offers to set the focus', async () => {
    await draw();
    const attention = document.querySelector('[data-testid="product-attention"]')!;

    expect(attention.textContent).toContain('Resume interrupted uploads');
    expect(attention.textContent).toContain('Recommendation: Build it');
    expect([...attention.querySelectorAll('a')].find(a => a.textContent === 'Review')?.getAttribute('href')).toBe('/dashboard/p/feature/10');
    expect(document.querySelector('[data-testid="product-focus"]')!.textContent).toContain('Set current focus');
  });

  it('keeps ids and counters behind Technical details, with units', async () => {
    await draw();
    const technical = document.querySelector<HTMLDetailsElement>('[data-testid="product-technical"]')!;

    expect(technical.open).toBe(false);
    expect(technical.textContent).toContain('23 releases (deployments, not features)');
    expect(document.querySelector('[data-testid="product-context"]')!.textContent).not.toMatch(/checkedOn|sourceUrl/);
  });

  it('lists where it runs only when an environment is recorded', async () => {
    await draw();

    expect(document.querySelector('[data-testid="product-environments"]')).toBeNull();

    await draw([row(40, 'send-api-production', { product: 'send', surface: 'api', stage: 'production', url: 'https://api.northwind.example', lastDeployedSha: '3f2a9c1d8e7f', lastHealth: 'ok' })]);
    const where = document.querySelector('[data-testid="product-environments"]')!;

    expect(where.textContent).toContain('API · production');
    expect(where.textContent).toContain('api.northwind.example');
    expect(where.textContent).toContain('3f2a9c1');
  });
});
