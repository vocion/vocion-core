import type { PageField, PageRow } from '@/libs/workspace/pages';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { REQUEST_STATUSES, withRequestStatus } from '@/libs/objects/requestStatuses.fixture';
import { deriveProductBoard } from '@/libs/workspace/productBoard';
import '@/styles/global.css';

/**
 * The Products card after the product owner's red team (2026-09-28), in a
 * real browser: name and a small mark, what it is for, the ONE thing that
 * needs you, what is underway, what last shipped, then stage and health —
 * and every one of those a place you can go from the card, not from ⋯.
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

/** As templates/plugins/software-factory/pages/products.yaml declares them. */
const FIELDS: PageField[] = [
  field({ key: 'title' }),
  field({ key: 'icon', from: 'meta.icon', format: 'icon' }),
  field({ key: 'tagline', from: 'meta.tagline' }),
  field({ key: 'attention', from: 'meta.attentionLine', emphasis: 'strong', toneFrom: 'meta.attentionTone', breakBefore: true, href: ['/dashboard/p/work?product={meta.slug}#{meta.attentionTab}', '/dashboard/p/products/{id}'] }),
  field({ key: 'inProgress', from: 'meta.inProgressLine', breakBefore: true, href: '/dashboard/p/work?product={meta.slug}#in-progress' }),
  field({ key: 'backlog', from: 'meta.backlogLine', href: '/dashboard/p/work?product={meta.slug}#proposed' }),
  field({ key: 'workNone', from: 'meta.workNoneLine' }),
  field({ key: 'latest', from: 'meta.latestReleaseLine', breakBefore: true, href: '/dashboard/objects/{meta.latestReleaseId}' }),
  field({ key: 'latestWhen', from: 'meta.latestReleaseAt', format: 'relative' }),
  field({ key: 'stage', from: 'meta.lifecycle', breakBefore: true }),
  field({ key: 'health', from: 'meta.healthLabel', toneFrom: 'meta.healthTone' }),
  field({ key: 'owner', from: 'meta.accountableUser', detail: true }),
];
const PRIMARY = { field: 'title', thumb: 'icon', subtitle: ['tagline', 'attention', 'inProgress', 'backlog', 'workNone', 'latest', 'latestWhen', 'stage', 'health'] };

const NOW = new Date('2026-09-24T12:00:00Z');

const PRODUCTS: PageRow[] = [
  { id: 7, title: 'Send', status: null, createdAt: null, meta: { slug: 'send', icon: 'send', tagline: 'Send big files and know when they were opened', stage: 'dogfood', health: 'ok', healthSource: 'deploy check', healthCheckedAt: '2026-09-23T09:00:00Z', accountableUser: 'owner@northwind.example' } },
  { id: 8, title: 'Slate', status: null, createdAt: null, meta: { slug: 'slate', icon: 'layers', tagline: 'Record your screen', stage: 'live' } },
];
const REQUESTS: PageRow[] = ([
  { id: 1, title: 'a', status: null, createdAt: NOW, meta: { product: 'send', state: 'triaged', recommendationState: 'proposed' } },
  { id: 2, title: 'b', status: null, createdAt: NOW, meta: { product: 'send', state: 'triaged', recommendationState: 'proposed' } },
  { id: 3, title: 'c', status: null, createdAt: NOW, meta: { product: 'send', state: 'building' } },
  { id: 4, title: 'd', status: null, createdAt: NOW, meta: { product: 'send', state: 'new' } },
] as PageRow[]).map(withRequestStatus);
const RELEASES: PageRow[] = [
  { id: 20, title: 'Email delivery tracking and bounce handling', status: null, createdAt: null, meta: { product: 'send', releasedAt: '2026-09-24T04:00:00Z' } },
];

async function board() {
  const rows = deriveProductBoard(PRODUCTS, { now: NOW, statuses: REQUEST_STATUSES, requests: REQUESTS, releases: RELEASES });
  render(
    <div className="mx-auto max-w-[1200px] p-6">
      <PageBlocks rows={rows} fields={FIELDS} primary={PRIMARY} rowLink="/dashboard/p/products/{id}" rowActions={[{ label: 'Wiki', href: '/dashboard/p/wiki' }]} rowActionsAs="menu" now={NOW.getTime()} />
    </div>,
  );

  await expect.element(page.getByText('Send', { exact: true })).toBeInTheDocument();
}

function card(name: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('[data-testid="block-card"]')].find(el => el.textContent?.includes(name))!;
}

describe('the card is several destinations, not one big link', () => {
  it('is not itself a link, and never nests one link in another', async () => {
    await board();

    expect(card('Send').tagName).not.toBe('A');
    expect(document.querySelectorAll('a a')).toHaveLength(0);
  });

  it('opens the product overview from its name', async () => {
    await board();
    const title = card('Send').querySelector('[data-testid="block-title-link"]');

    expect(title?.getAttribute('href')).toBe('/dashboard/p/products/7');
  });

  it('opens the decisions, the work and the backlog on Work, filtered to this product', async () => {
    await board();
    const send = card('Send');
    const href = (key: string) => send.querySelector(`[data-testid="fact-link-${key}"]`)?.getAttribute('href');

    expect(href('attention')).toBe('/dashboard/p/work?product=send#proposed');
    expect(href('inProgress')).toBe('/dashboard/p/work?product=send#in-progress');
    expect(href('backlog')).toBe('/dashboard/p/work?product=send#proposed');
    expect(href('latest')).toBe('/dashboard/objects/20');
  });
});

describe('what the card says, in order', () => {
  it('reads name, purpose, attention, work, latest release, then stage and health, one line each', async () => {
    await board();
    const lines = [...card('Send').querySelectorAll('[data-testid="block-line"]')].map(l => l.textContent?.replace(/\s*·\s*/g, ' · ').replace(/\s+/g, ' ').trim());

    expect(lines[0]).toBe('Send big files and know when they were opened');
    expect(lines[1]).toBe('Review 2 decisions');
    expect(lines[2]).toBe('1 change in progress · 3 open requests');
    expect(lines[3]).toMatch(/^Latest: Email delivery tracking and bounce handling · 8h ago$/);
    // The deploy check ran BEFORE the latest release, so its ok is not about
    // what people are using now.
    expect(lines[4]).toBe('Internal testing · Health check outdated');
  });

  it('says a decision once', async () => {
    await board();
    const text = card('Send').textContent ?? '';

    expect(text).not.toContain('to decide');
    expect(text).not.toContain('Waiting on you');
  });

  it('says a product with nothing tracked and nothing watching exactly that', async () => {
    await board();
    const text = card('Slate').textContent ?? '';

    expect(text).toContain('No work tracked here');
    expect(text).toContain('Health unavailable · Connect monitoring');
    expect(text).not.toContain('Quiet');
    expect(text).not.toContain('dogfood');
  });

  it('draws the mark small beside the name, not as a full-height strip', async () => {
    await board();
    const mark = card('Send').querySelector<HTMLElement>('[data-testid="block-mark"]')!;

    expect(mark.getBoundingClientRect().width).toBeLessThanOrEqual(32);
    expect(card('Send').querySelector('[data-testid="block-thumb"]')).toBeNull();
  });

  it('never scrolls sideways on a phone', async () => {
    await page.viewport(390, 844);
    await board();

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });
});
