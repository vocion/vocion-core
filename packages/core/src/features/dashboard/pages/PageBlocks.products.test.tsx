import type { PageField, PageRow } from '@/libs/workspace/pages';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * The Products board, in a real browser, over the two products that exist.
 *
 * The test the page is built to pass: could a person understand the state of
 * every Squatch product while walking from their desk to the kitchen? So what
 * is asserted here is what each row SAYS, and just as much what it does not.
 *
 * Send is in dogfood, priced against DocSend, watched by a deploy check and
 * has work open. Slate is live, owned by Garrett, has nothing watching it and
 * no price recorded. Between them they cover the three cases that used to
 * render identically and must not: a product with pricing and one without, a
 * healthy product and an unmonitored one, and a field neither of them can
 * fill.
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
  return {
    label: over.key,
    format: 'text',
    total: false,
    priority: 1,
    hideWhenConstant: false,
    hideWhenEmpty: true,
    ...over,
  } as PageField;
}

/** The board's fields, as templates/plugins/software-factory declares them. */
const FIELDS: PageField[] = [
  field({ key: 'title', label: 'Product' }),
  field({ key: 'stage', label: 'Stage', from: 'meta.stage', format: 'badge', tones: { dogfood: 'warn', live: 'ok' } }),
  field({
    key: 'health',
    label: 'Health',
    from: 'meta.health',
    format: 'badge',
    tones: { ok: 'ok', degraded: 'warn', down: 'bad' },
    source: { from: ['meta.healthSource', 'meta.healthCheckedAt'], absentLabel: 'monitoring not connected' },
  }),
  field({ key: 'owner', label: 'Accountable', from: 'meta.accountableUser' }),
  field({
    key: 'price',
    label: 'Our price',
    from: 'meta.ourPrice',
    format: 'compare',
    beside: { from: 'meta.incumbent.listPrice', labelFrom: 'meta.incumbent.name', checkedFrom: 'meta.incumbent.checkedOn' },
  }),
  field({ key: 'lastShipped', label: 'Last shipped', from: 'meta.lastShipped', caption: { from: 'meta.lastReleaseAt', format: 'relative' } }),
  field({
    key: 'open',
    label: 'Open work',
    from: 'meta.openRequests',
    format: 'workload',
    workload: { noun: 'open request', inFlightFrom: 'meta.inFlight', urgentFrom: 'meta.p1Open', urgentLabel: 'urgent' },
  }),
  field({ key: 'revenue', label: 'Revenue', from: 'meta.revenueMonthCents', format: 'money' }),
  field({ key: 'updated', label: 'Counters last recomputed', from: 'meta.countersUpdatedAt', format: 'relative', staleAfterHours: 24 }),
];

const PRIMARY = { field: 'title', subtitle: ['stage', 'health', 'owner'] };

const NOW = Date.parse('2026-09-21T18:00:00Z');

const SHIPPED = 'The document page has one Share button. It opens a composer that mails the link.';

const ROWS: PageRow[] = [
  {
    id: 25,
    title: 'Send',
    status: 'active',
    createdAt: new Date('2026-09-20T22:38:17Z'),
    meta: {
      stage: 'dogfood',
      health: 'ok',
      healthSource: 'deploy check',
      healthCheckedAt: '2026-09-21T14:40:00.000Z',
      ourPrice: '$15/mo per seat, $150/yr',
      incumbent: { name: 'DocSend by Dropbox', listPrice: '$30/user/mo', checkedOn: '2026-09-19' },
      accountableUser: 'chris@metacto.com',
      lastShipped: SHIPPED,
      lastReleaseAt: '2026-09-21T14:37:07.062Z',
      openRequests: 3,
      inFlight: 1,
      p1Open: 0,
      countersUpdatedAt: '2026-09-21T11:00:00.000Z',
    },
  },
  {
    id: 26,
    title: 'Slate',
    status: 'active',
    createdAt: new Date('2026-09-20T22:38:17Z'),
    meta: {
      stage: 'live',
      incumbent: { name: 'Loom' },
      accountableUser: 'garrett@metacto.com',
      countersUpdatedAt: '2026-09-21T11:00:00.000Z',
    },
  },
];

async function board(rows: PageRow[] = ROWS) {
  render(
    <div className="mx-auto max-w-[1200px] p-6">
      <PageBlocks rows={rows} fields={FIELDS} primary={PRIMARY} rowLink="/dashboard/objects/{id}" now={NOW} />
    </div>,
  );

  await expect.element(page.getByText('Send', { exact: true })).toBeInTheDocument();
}

/**
 * The block a product's name leads.
 * @param name - The product's title.
 */
function block(name: string): HTMLElement {
  const hit = [...document.querySelectorAll('a[href^="/dashboard/objects/"]')]
    .find(el => el.textContent?.trimStart().startsWith(name));

  return hit as HTMLElement;
}

describe('a product reads as a block, not as a row of fourteen columns', () => {
  it('does not draw a table at all, so there is no header to look back up at', async () => {
    await board();

    expect(document.querySelector('table')).toBeNull();
  });

  it('never scrolls sideways, at a phone width or a laptop one', async () => {
    await page.viewport(390, 844);
    await board();

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });
});

describe('a field no product can fill is gone, not blank', () => {
  it('does not mention revenue anywhere, because no verified revenue source exists', async () => {
    await board();

    expect(document.body.textContent).not.toContain('Revenue');
  });

  it('draws no dashes, because a sparse product is short here rather than gappy', async () => {
    await board();

    expect(document.body.textContent).not.toContain('\u2014');
  });

  it('brings the field back the moment one product can fill it', async () => {
    const withRevenue = [{ ...ROWS[0]!, meta: { ...ROWS[0]!.meta, revenueMonthCents: 120_000 } }, ROWS[1]!];
    await board(withRevenue);

    expect(document.body.textContent).toContain('Revenue');
    expect(document.body.textContent).toContain('$1200.00');
  });
});

describe('health names our gap rather than doubting the product', () => {
  it('says the unmonitored product is unmonitored, in those words', async () => {
    await board();

    expect(block('Slate').textContent).toContain('monitoring not connected');
  });

  it('never says unknown', async () => {
    await board();

    expect(document.body.textContent?.toLowerCase()).not.toContain('unknown');
  });

  it('reads the watched product as healthy, which is a different sentence', async () => {
    await board();

    expect(block('Send').textContent).toContain('ok');
    expect(block('Send').textContent).not.toContain('monitoring not connected');
  });

  it('keeps a degraded product distinct from an unmonitored one', async () => {
    const degraded = [{ ...ROWS[0]!, meta: { ...ROWS[0]!.meta, health: 'degraded' } }, ROWS[1]!];
    await board(degraded);

    expect(block('Send').textContent).toContain('degraded');
    expect(block('Slate').textContent).toContain('monitoring not connected');
    expect(block('Slate').textContent).not.toContain('degraded');
  });
});

describe('price against the incumbent is one fact, and the loudest one', () => {
  it('reads as our price against theirs, by name', async () => {
    await board();

    const text = block('Send').textContent ?? '';

    expect(text).toContain('$15/mo per seat, $150/yr');
    expect(text).toContain('against DocSend by Dropbox $30/user/mo');
  });

  it('carries the date it was checked on hover rather than in a column of its own', async () => {
    await board();

    const compare = block('Send').querySelector('[data-testid="compare-value"]')!;

    expect(compare.getAttribute('title')).toContain('Checked');
    expect(document.body.textContent).not.toContain('Price checked');
  });

  it('is set in larger type than the facts around it, because it is the thesis', async () => {
    await board();

    const compare = block('Send').querySelector('[data-testid="compare-value"]')!;
    const ours = compare.firstElementChild!;
    const theirs = compare.lastElementChild!;
    const shipped = [...block('Send').querySelectorAll('dd')].find(d => d.textContent?.includes(SHIPPED))!;

    expect(Number.parseFloat(getComputedStyle(ours).fontSize))
      .toBeGreaterThan(Number.parseFloat(getComputedStyle(shipped).fontSize));
    expect(Number.parseFloat(getComputedStyle(ours).fontSize))
      .toBeGreaterThan(Number.parseFloat(getComputedStyle(theirs).fontSize));
  });

  it('says the product without a price is unpriced, and still names who it is measured against', async () => {
    await board();

    const text = block('Slate').textContent ?? '';

    expect(text).toContain('not priced yet');
    expect(text).toContain('against Loom');
    expect(text).toContain('price not recorded');
  });
});

describe('what shipped, not how many', () => {
  it('leads with the shipment in the words the public reads, and when under it', async () => {
    await board();

    const text = block('Send').textContent ?? '';

    expect(text).toContain(SHIPPED);
    expect(text).toContain('ago');
    expect(text).not.toContain('this month');
  });

  it('says only when, never a dash, on a product whose release was never given a headline', async () => {
    const noHeadline = [{ ...ROWS[0]!, meta: { ...ROWS[0]!.meta, lastShipped: undefined } }, ROWS[1]!];
    await board(noHeadline);

    const shipped = [...block('Send').querySelectorAll('div')].find(d => d.textContent?.startsWith('Last shipped'))!;

    expect(shipped.textContent).toContain('ago');
    expect(shipped.textContent).not.toContain('\u2014');
  });

  it('says nothing about shipping on a product that has not shipped here', async () => {
    await board();

    expect(block('Slate').textContent).not.toContain('Last shipped');
  });
});

describe('open work has a shape', () => {
  it('says how much is moving and whether anything is urgent', async () => {
    await board();

    const text = block('Send').textContent ?? '';

    expect(text).toContain('3 open requests');
    expect(text).toContain('1 being worked on');
    expect(text).toContain('none urgent');
  });

  it('gives the urgent part weight only when there is some', async () => {
    const urgent = [{ ...ROWS[0]!, meta: { ...ROWS[0]!.meta, p1Open: 2 } }, ROWS[1]!];
    await board(urgent);

    expect(block('Send').textContent).toContain('2 urgent');
    expect(block('Send').textContent).not.toContain('none urgent');
  });
});

describe('freshness is drawn only once it stops being fresh', () => {
  it('says nothing about when the counters ran while they are current', async () => {
    await board();

    expect(document.body.textContent).not.toContain('Counters last recomputed');
  });

  it('says so on the row that has gone stale, and only that row', async () => {
    const stale = [ROWS[0]!, { ...ROWS[1]!, meta: { ...ROWS[1]!.meta, countersUpdatedAt: '2026-09-17T11:00:00.000Z' } }];
    await board(stale);

    expect(block('Slate').textContent).toContain('Counters last recomputed');
    expect(block('Send').textContent).not.toContain('Counters last recomputed');
  });
});
