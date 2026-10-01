import type { PageRow } from '@/libs/workspace/pageFields';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { buildProductOverview } from '@/libs/workspace/productOverview';
import { recordLinker, recordLinksOf } from '@/libs/workspace/recordHref';
import '@/styles/global.css';

/**
 * A product's overview, drawn: the sections in the order a person running
 * the product asks, with the record's machinery behind a disclosure.
 */

const undoAction = vi.fn(async () => ({ ok: true }));
const propose = vi.fn(async () => ({ runId: 77, status: 'done' }));
vi.mock('@/libs/Orpc', () => ({ client: { review: { undoAction, propose, decideAction: vi.fn() } } }));
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

async function draw(environments: PageRow[] = [], writes: import('@/services/objects/related').RelatedWrite[] = [], related: import('@/libs/workspace/related').RelatedItem[] = []) {
  const overview = buildProductOverview({
    environments,
    product: SEND,
    products: [SEND],
    requests: [
      row(10, 'Resume interrupted uploads', { product: 'send', state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build' }),
      row(11, 'Email delivery tracking', { product: 'send', state: 'building' }),
    ],
    releases: [row(20, 'Share button', { product: 'send', releasedAt: '2026-09-23T00:00:00Z', liveSummary: '3 of 4 live states reached', liveCheckedAt: '2026-09-23T01:00:00Z', liveEvidence: [{ status: 'reached' }, { status: 'reached' }, { status: 'reached' }, { status: 'not_reached' }], prUrls: ['https://github.com/Acme/northwind-core/pull/9'] })],
    ownerName: 'Dana Reyes',
    links: { workSlug: 'work', releasesSlug: 'releases', record: recordLinker(recordLinksOf([{ slug: 'feature', archetype: 'report', report: { subject: 'request' } }] as never)) },
    now: NOW,
  });
  render(<ProductOverviewView overview={overview} page={{ slug: 'products', title: 'Products' }} now={NOW.getTime()} writes={writes} related={related} folded={['engineering']} requestType="request" />);

  await expect.element(page.getByRole('heading', { name: 'Send', level: 1 })).toBeInTheDocument();
}

describe('the product overview', () => {
  it('is reached from Products, with no object furniture, and says live health in one line', async () => {
    await draw();
    const crumbs = document.querySelector('nav[aria-label="Breadcrumb"]')!;

    expect(crumbs.textContent).toBe('ProductsSend');
    expect(crumbs.querySelector('a')?.getAttribute('href')).toBe('/dashboard/p/products');

    const header = document.querySelector('[data-pattern="detail-header"]')!.textContent ?? '';

    expect(header).not.toContain('Objects');
    expect(header).not.toContain('Back to Products');
    expect(header).not.toContain('#2');
    expect(header).toContain('Internal testing');
    expect(header).toContain('Owned by Dana Reyes');
    expect(document.querySelector('[data-testid="product-live-health"]')).not.toBeNull();
  });

  it('draws the sections in the order a product manager asks them, with how it ships folded', async () => {
    await draw();
    const order = ['product-doing', 'product-attention', 'product-work', 'product-releases', 'product-proposed', 'product-context', 'product-engineering'];
    const tops = order.map(id => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top);

    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(document.querySelector<HTMLDetailsElement>('[data-testid="product-engineering"]')!.open).toBe(false);
  });

  it('says each figure with its direction', async () => {
    await draw();
    const measures = document.querySelector('[data-testid="product-measures"]')!;

    expect(measures.querySelector('[data-measure="releases"]')?.textContent).toContain('vs prior 30 days');
  });

  it('says the decision once under Needs you, and lists the proposal compactly with Build and Dismiss', async () => {
    await draw();
    const needs = document.querySelector('[data-testid="product-attention"]')!;

    expect(needs.textContent).toContain('1 proposal waiting for your decision');
    expect(needs.textContent).not.toContain('Recommendation');

    const proposal = document.querySelector('[data-testid="product-proposal"]')!;

    expect(proposal.textContent).toContain('Resume interrupted uploads');
    expect(proposal.querySelector('a')?.getAttribute('href')).toBe('/dashboard/p/feature/10');
    expect(proposal.querySelector('[data-testid="feature-build"]')).not.toBeNull();
    expect(proposal.querySelector('[data-testid="feature-dismiss"]')).not.toBeNull();

    await page.getByTestId('feature-dismiss').click();

    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'objects.update_meta', input: expect.objectContaining({ objectType: 'request', id: 10 }) }));
  });

  it('says whether each release was seen working live', async () => {
    await draw();

    expect(document.querySelector('[data-testid="product-release-live"]')).not.toBeNull();
  });

  it('keeps ids and counters behind How it ships, with units', async () => {
    await draw();
    const technical = document.querySelector<HTMLDetailsElement>('[data-testid="product-technical"]')!;

    expect(technical.open).toBe(false);
    expect(technical.textContent).toContain('23 releases (deployments, not features)');
    expect(document.querySelector('[data-testid="product-context"]')!.textContent).not.toMatch(/checkedOn|sourceUrl/);
  });

  it('lists where it runs inside How it ships, with the run, the deploy and the QA sign-in', async () => {
    await draw([row(40, 'send-api-production', { product: 'send', surface: 'api', stage: 'production', url: 'https://api.northwind.example', lastDeployedSha: '3f2a9c1d8e7f', lastHealth: 'ok', lastDeployRunUrl: 'https://github.com/Acme/northwind-core/actions/runs/51', lastPipelineLine: 'Deployed 3f2a9c1 to send-api-production (run #51); healthy.', qaLoginCredentialId: 7, deploy: { workflow: '.github/workflows/deploy.yml', step: 'API' } })]);
    const where = document.querySelector('[data-testid="product-engineering"]')!;

    expect(where.textContent).toContain('API · production');
    expect(where.textContent).toContain('api.northwind.example');
    expect(where.textContent).toContain('3f2a9c1');
    // The run that deployed it, one tap away, and what the pipeline last did there.
    expect(where.querySelector('[data-testid="product-environment-run"]')?.getAttribute('href')).toBe('https://github.com/Acme/northwind-core/actions/runs/51');
    expect(where.querySelector('[data-testid="product-environment-line"]')?.textContent).toBe('Deployed 3f2a9c1 to send-api-production (run #51); healthy.');
    expect(where.querySelector('[data-testid="product-environment-config"]')?.textContent).toContain('Deploys by .github/workflows/deploy.yml, step API · QA sign-in stored');
  });

  it('says where each environment\'s errors are tracked, with a link to them', async () => {
    await draw([row(41, 'send-api-production', { product: 'send', surface: 'api', stage: 'production', observability: { sentry: { org: 'northwind', project: 'northwind-api' } } })]);
    const line = document.querySelector('[data-testid="product-environment-errors"]')!;

    expect(line.textContent).toBe('Errors: northwind/northwind-api (production) · open issues not read · Sentry');
    expect(line.querySelector('a')?.getAttribute('href')).toContain('https://northwind.sentry.io/issues/');
  });

  it('previews each wiki page about the product, and keeps it out of Related', async () => {
    await draw([], [], [
      { key: 'wiki:page:5', relation: 'wiki', label: 'Wiki', title: 'Send standards', href: '/dashboard/artifacts/5', external: false, preview: { type: 'artifact', id: '5' }, kind: 'page', note: null, details: ['Every link opens in under a second.'], at: '2026-09-30T04:31:10Z' },
      { key: 'plans:object:9', relation: 'plans', label: 'Plans', title: '#9 Plan', href: '/dashboard/objects/9', external: false, preview: { type: 'object', id: '9' }, kind: 'record', note: null, at: null },
    ]);
    const wiki = document.querySelector('[data-testid="product-wiki"]')!;

    expect(wiki.textContent).toContain('Send standards');
    expect(wiki.textContent).toContain('Every link opens in under a second.');
    expect(wiki.textContent).toContain('Updated Sep 30');
    expect(wiki.querySelector('a')?.getAttribute('href')).toBe('/dashboard/artifacts/5');
    expect(document.querySelector('[data-testid="product-related"]')!.textContent).not.toContain('Send standards');
  });

  it('reads a pipeline move in its own words on the Activity, newest first, with its Undo', async () => {
    await draw([], [
      { runId: 902, recordId: 40, title: 'send-api-production', by: 'release-engineer', at: '2026-09-24T10:00:00Z', href: '/dashboard/objects/40', preview: { type: 'record_history', id: '40' }, line: 'Re-ran the failed jobs of Acme/northwind-core/actions/runs/36001.', undoable: false, undone: true },
      { runId: 901, recordId: 40, title: 'send-api-production', by: 'release-engineer', at: '2026-09-24T11:00:00Z', href: '/dashboard/objects/40', preview: { type: 'record_history', id: '40' }, line: 'Started deploy.yml on main for feed000 (run #52).', undoable: true, undone: false },
    ]);
    const writes = document.querySelector('[data-testid="product-writes"]')!;

    expect(writes.querySelector('li')?.textContent).toContain('release-engineer on send-api-production: Started deploy.yml on main for feed000 (run #52).');
    expect(writes.textContent).toContain('· undone');
    expect(writes.querySelectorAll('[data-testid="product-write-undo"]')).toHaveLength(1);

    await page.getByTestId('product-write-undo').click();

    expect(undoAction).toHaveBeenCalledWith({ id: 901 });
  });
});
