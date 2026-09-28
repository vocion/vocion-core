import type { PageRow } from './pageFields';
import type { OverviewLinks } from './productOverview';
import { describe, expect, it } from 'vitest';
import { subtitleLines } from './pageFields';
import { buildProductOverview } from './productOverview';

const NOW = new Date('2026-09-24T12:00:00Z');

const LINKS: OverviewLinks = { workSlug: 'work', requestLink: '/dashboard/p/feature/{id}', releasesSlug: 'releases', releaseLink: '/dashboard/objects/{id}' };

function row(id: number, title: string, meta: Record<string, unknown>): PageRow {
  return { id, title, status: null, createdAt: new Date('2026-09-20T00:00:00Z'), meta };
}

const CORE = row(1, 'Squatch Core', { slug: 'core' });
const SEND = row(2, 'Send', {
  slug: 'send',
  tagline: 'Send big files and know when they were opened',
  stage: 'dogfood',
  accountableUser: 'owner@northwind.example',
  urls: { app: 'https://app.northwind.example', site: 'https://northwind.example', api: 'https://api.northwind.example' },
  health: 'ok',
  healthSource: 'deploy check',
  healthCheckedAt: '2026-09-22T09:00:00Z',
  dependsOn: ['core'],
  promises: ['Links never expire on the paid plan'],
  ourPrice: '$15/mo per seat',
  incumbent: { name: 'Kestrel Share', comparePlan: 'Advanced', listPrice: '$45/user/month', checkedOn: '2026-09-19', sourceUrl: 'https://kestrel.example/pricing' },
  repos: ['send-web'],
  openRequests: 4,
  inFlight: 1,
  shippedThisMonth: 23,
  theme: { name: 'Delivery', checkedOn: '2026-09-01' },
});

const REQUESTS: PageRow[] = [
  row(10, 'Resume interrupted uploads', { product: 'send', state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build', expectedResult: 'Interrupted uploads resume instead of failing.', mainRisk: 'Touches the upload flow.', decisionCost: 5, why: ['user_request'] }),
  row(11, 'Email delivery tracking', { product: 'send', state: 'building' }),
  row(12, 'Stuck build', { product: 'send', state: 'building', blocker: { what: 'a missing API key', owner: 'person' } }),
  row(13, 'Dark mode', { product: 'send', state: 'triaged' }),
  row(14, 'Share button', { product: 'send', state: 'shipped', answeredAt: '2026-09-23T00:00:00Z' }),
  row(15, 'Slate thing', { product: 'slate', state: 'triaged', recommendationState: 'proposed' }),
];

const RELEASES: PageRow[] = [
  row(20, 'Email delivery tracking and bounce handling', { product: 'send', releasedAt: '2026-09-24T04:00:00Z', healthAfter: 'ok' }),
  row(21, 'Share button', { product: 'send', releasedAt: '2026-09-02T00:00:00Z' }),
  row(22, 'Last month', { product: 'send', releasedAt: '2026-08-30T00:00:00Z' }),
];

function build(over: Partial<Parameters<typeof buildProductOverview>[0]> = {}) {
  return buildProductOverview({ product: SEND, products: [CORE, SEND], requests: REQUESTS, releases: RELEASES, ownerName: 'Dana Reyes', links: LINKS, now: NOW, ...over });
}

describe('the header is the product, not the record', () => {
  it('names it, says what it is for, its stage in words, its owner by name, and where it lives', () => {
    const o = build();

    expect(o.name).toBe('Send');
    expect(o.tagline).toBe('Send big files and know when they were opened');
    expect(o.lifecycle).toBe('Internal testing');
    expect(o.owner).toEqual({ name: 'Dana Reyes', email: 'owner@northwind.example' });
    expect(o.appUrl).toBe('https://app.northwind.example');
    expect(o.siteUrl).toBe('https://northwind.example');
  });

  it('falls back to the address when the owner is not a member', () => {
    expect(build({ ownerName: null }).owner?.name).toBe('owner@northwind.example');
  });
});

describe('needs attention names the decisions, with what to do and what it costs', () => {
  it('lists this product\'s decisions by name, with the recommendation, consequence, owner and a Review link', () => {
    const [d, ...rest] = build().attention.decisions;

    expect(rest).toHaveLength(0);
    expect(d).toMatchObject({
      title: 'Resume interrupted uploads',
      recommendation: 'Build it',
      consequence: 'Interrupted uploads resume instead of failing.',
      risk: 'Touches the upload flow.',
      owner: 'Dana Reyes',
      minutes: 5,
      href: '/dashboard/p/feature/10',
    });
  });

  it('lists blocked work with what it is blocked on', () => {
    expect(build().attention.blocked).toEqual([{ id: 12, title: 'Stuck build', blocker: 'a missing API key', href: '/dashboard/p/feature/12' }]);
  });

  it('names the visibility gaps a person could fix: an outdated check, a missing owner', () => {
    const o = build({ product: { ...SEND, meta: { ...SEND.meta, accountableUser: undefined } } });

    expect(o.attention.gaps.some(g => g.includes('before the latest release'))).toBe(true);
    expect(o.attention.gaps.some(g => g.includes('No one is recorded as accountable'))).toBe(true);
    expect(o.attention.reviewHref).toBe('/dashboard/p/work?product=send#proposed');
  });
});

describe('current focus is a person\'s words or an invitation, never generated', () => {
  it('is empty until set', () => {
    expect(build().focus).toBeNull();
  });

  it('reads the recorded focus', () => {
    expect(build({ product: { ...SEND, meta: { ...SEND.meta, currentFocus: 'Make sharing reliable enough to leave dogfood.' } } }).focus).toBe('Make sharing reliable enough to leave dogfood.');
  });
});

describe('work in progress is Work\'s own rows', () => {
  it('names each change with its status and next step, and links the backlog', () => {
    const o = build();

    expect(o.work.inProgress.map(w => w.title).sort()).toEqual(['Email delivery tracking', 'Stuck build']);
    expect(o.work.inProgress.find(w => w.title === 'Stuck build')?.status).toBe('Blocked');
    expect(o.work.queued).toBe(2);
    expect(o.work.workHref).toBe('/dashboard/p/work?product=send#in-progress');
    expect(o.work.backlogHref).toBe('/dashboard/p/work?product=send#proposed');
  });
});

describe('recent releases and performance say their units', () => {
  it('lists releases newest first, each linked', () => {
    const o = build();

    expect(o.releases.recent.map(r => r.title)).toEqual(['Email delivery tracking and bounce handling', 'Share button', 'Last month']);
    expect(o.releases.recent[0]?.href).toBe('/dashboard/objects/20');
    expect(o.releases.allHref).toBe('/dashboard/p/releases?product=send');
  });

  it('counts releases this month as deployments, from the records, and says so', () => {
    const measures = build().performance.measures;

    expect(measures.find(m => m.label === 'Releases this month')?.value).toBe('2 releases deployed since 2026-09-01');
    expect(measures.find(m => m.label === 'Requests shipped')?.value).toBe('1 request shipped in the last 14 days');
  });

  it('offers to connect usage and revenue instead of drawing an empty chart', () => {
    expect(build().performance.connect).toContain('Connect analytics or billing');
  });

  it('labels the stored "shipped this month" counter with its unit', () => {
    const fact = build().technical.facts.find(f => f.label.startsWith('Deployments this month'));

    expect(fact?.value).toBe('23 releases (deployments, not features)');
  });
});

describe('product context is readable, and the machinery is behind technical details', () => {
  it('draws the incumbent as a sentence with its source, never as raw keys', () => {
    const o = build();

    expect(o.context.incumbent).toEqual({ name: 'Kestrel Share', plan: 'Advanced', price: '$45/user/month', checkedOn: '2026-09-19', sourceUrl: 'https://kestrel.example/pricing' });
    expect(o.context.promises).toEqual(['Links never expire on the paid plan']);
    expect(o.context.builtOn).toBe('Built on Squatch Core');
  });

  it('keeps repository, API and counters in technical details, and other fields readable', () => {
    const o = build();
    const labels = o.technical.facts.map(f => f.label);

    expect(labels).toEqual(expect.arrayContaining(['Slug', 'Record', 'Repositories', 'API', 'Open requests (counter)']));

    const theme = o.technical.other.find(f => f.label === 'Theme');

    expect(theme?.value).toBe('Name Delivery · Checked on 2026-09-01');
    expect(o.technical.other.map(f => f.value).join(' ')).not.toMatch(/[{}]/);
  });

  it('reads only its own product\'s requests', () => {
    expect(build({ product: row(3, 'Slate', { slug: 'slate' }) }).attention.decisions.map(d => d.id)).toEqual([15]);
  });
});

describe('a card\'s subtitle breaks into lines', () => {
  const f = (key: string, breakBefore?: boolean) => ({ key, from: `meta.${key}`, format: 'text', total: false, priority: 1, hideWhenConstant: false, detail: false, hideWhenEmpty: true, breakBefore }) as never;

  it('starts a new line at each break, and an empty field still breaks', () => {
    const r = row(1, 'x', { a: 'A', c: 'C', d: 'D' });
    const lines = subtitleLines([f('a'), f('b', true), f('c'), f('d', true)], r, NOW.getTime());

    expect(lines.map(l => l.map(x => (x as { key: string }).key))).toEqual([['a'], ['c'], ['d']]);
  });
});

describe('where it runs', () => {
  const ENVS: PageRow[] = [
    row(30, 'send-local', { slug: 'send-local', product: 'send', surface: 'api', stage: 'local', url: 'http://localhost:3100' }),
    row(31, 'send-web-production', { slug: 'send-web-production', product: 'send', surface: 'web', stage: 'production', url: 'https://app.northwind.example' }),
    row(32, 'send-api-production', { slug: 'send-api-production', product: 'send', surface: 'api', stage: 'production', url: 'https://api.northwind.example', lastDeployedSha: '3f2a9c1d8e7f', lastDeployedAt: '2026-09-24T10:00:00Z', lastHealth: 'ok' }),
    row(33, 'slate-api-production', { slug: 'slate-api-production', product: 'slate', surface: 'api', stage: 'production' }),
  ];

  it('lists this product\'s environments, production first, with what the last deploy left there', () => {
    const o = build({ environments: ENVS });

    expect(o.environments.map(e => e.name)).toEqual(['API · production', 'Web app · production', 'API · local']);
    expect(o.environments[0]).toMatchObject({ deployedSha: '3f2a9c1', health: 'ok', href: '/dashboard/objects/32' });
    expect(o.environments[1]).toMatchObject({ deployedSha: null, deployedAt: null, health: null });
  });

  it('is empty, not a list of blanks, when none is recorded', () => {
    expect(build().environments).toEqual([]);
  });
});
