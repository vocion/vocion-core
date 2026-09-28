import type { PageRow } from './pageFields';
import { describe, expect, it } from 'vitest';
import { interpolateHref, resolveRowActionHref } from './pageFields';
import { attentionOf, deriveProductBoard, healthReading, lifecycleLabel, productCard, productWork } from './productBoard';

const NOW = new Date('2026-09-24T12:00:00Z');

function product(id: number, meta: Record<string, unknown>, title = `p${id}`): PageRow {
  return { id, title, status: null, createdAt: null, meta };
}

function request(id: number, meta: Record<string, unknown>, title = `r${id}`): PageRow {
  return { id, title, status: null, createdAt: new Date('2026-09-20T00:00:00Z'), meta: { product: 'send', askedAt: '2026-09-20T00:00:00Z', ...meta } };
}

function release(id: number, title: string, releasedAt: string, product = 'send'): PageRow {
  return { id, title, status: null, createdAt: null, meta: { product, releasedAt } };
}

const SEND = { slug: 'send', stage: 'dogfood', health: 'ok', healthSource: 'deploy check', healthCheckedAt: '2026-09-24T09:00:00Z' };

describe('lifecycle is a stage, in words, never a warning', () => {
  it('reads dogfood as internal testing, and the rest as a person running a product says them', () => {
    expect(lifecycleLabel(product(1, { stage: 'dogfood' }))).toBe('Internal testing');
    expect(lifecycleLabel(product(1, { stage: 'beta' }))).toBe('Beta');
    expect(lifecycleLabel(product(1, { stage: 'live' }))).toBe('Live');
    expect(lifecycleLabel(product(1, { stage: 'retired' }))).toBe('Retired');
    expect(lifecycleLabel(product(1, {}))).toBeNull();
  });
});

describe('health is a current reading or it says it is not', () => {
  it('passes only on a fresh check that ran after the latest release', () => {
    expect(healthReading(product(1, SEND), NOW, new Date('2026-09-24T08:00:00Z')).label).toBe('Current checks passed');
  });

  it('calls an ok from before the latest release outdated, never ok', () => {
    const r = healthReading(product(1, SEND), NOW, new Date('2026-09-24T10:00:00Z'));

    expect(r.state).toBe('outdated');
    expect(r.label).toBe('Health check outdated');
    expect(r.detail).toContain('before the latest release');
  });

  it('calls an ok older than the freshness window outdated', () => {
    const r = healthReading(product(1, { ...SEND, healthCheckedAt: '2026-09-21T09:00:00Z' }), NOW, null);

    expect(r.state).toBe('outdated');
    expect(r.detail).toContain('48 hours');
  });

  it('keeps an issue an issue however old the check is', () => {
    expect(healthReading(product(1, { ...SEND, health: 'down', healthCheckedAt: '2026-09-01T00:00:00Z' }), NOW, null).label).toBe('Issue detected');
  });

  it('says monitoring is missing when nothing is watching, rather than doubting the product', () => {
    const r = healthReading(product(1, { stage: 'live' }), NOW);

    expect(r.state).toBe('unavailable');
    expect(r.label).toBe('Health unavailable · Connect monitoring');
    expect(r.label.toLowerCase()).not.toContain('unknown');
  });

  it('keeps stage and health apart: a live product can have an outdated check', () => {
    const [row] = deriveProductBoard([product(1, { ...SEND, stage: 'live', healthCheckedAt: '2026-09-01T00:00:00Z' })], { now: NOW });

    expect(row!.meta.lifecycle).toBe('Live');
    expect(row!.meta.healthLabel).toBe('Health check outdated');
  });
});

describe('what needs a person is one action', () => {
  const requests = [
    request(1, { state: 'triaged', recommendationState: 'proposed' }, 'Resume interrupted uploads'),
    request(2, { state: 'triaged', recommendationState: 'proposed' }, 'Bounce handling'),
    request(3, { state: 'building' }, 'Email delivery tracking'),
    request(4, { state: 'triaged' }),
    request(5, { state: 'new' }),
    request(6, { state: 'shipped', answeredAt: '2026-09-23T00:00:00Z' }),
    request(7, { state: 'triaged' }, 'Another product'),
  ];
  requests[6]!.meta.product = 'slate';

  it('counts decisions, work and the backlog the way Work does, for this product only', () => {
    const work = productWork(product(1, SEND), { requests }, NOW);

    expect(work.decisions).toBe(2);
    expect(work.inProgress).toBe(1);
    expect(work.queued).toBe(4);
    expect(work.tracked).toBe(true);
  });

  it('says a decision once, as the action, and never also as "to decide"', () => {
    const meta = productCard(product(1, SEND), [], { requests, releases: [] }, NOW);

    expect(meta.attentionLine).toBe('Review 2 decisions');
    expect(meta.inProgressLine).toBe('1 change in progress');
    expect(meta.backlogLine).toBe('4 open requests');

    const all = Object.values(meta).filter(v => typeof v === 'string').join(' | ');

    expect(all).not.toContain('to decide');
    expect(all).not.toContain('Waiting on you');
  });

  it('puts an issue ahead of a decision, and blocked work after it', () => {
    const work = productWork(product(1, SEND), { requests }, NOW);

    expect(attentionOf(healthReading(product(1, { ...SEND, health: 'degraded' }), NOW, null), work)?.line).toBe('Issue detected · 1 change in progress');
    expect(attentionOf(healthReading(product(1, SEND), NOW, null), { ...work, decisions: 0, blocked: 1 })?.line).toBe('Unblock 1 change');
    expect(attentionOf(healthReading(product(1, SEND), NOW, null), { ...work, decisions: 0, blocked: 0 })).toBeNull();
  });

  it('falls back to the rollups when the requests were not loaded', () => {
    const work = productWork(product(1, { ...SEND, awaitingDecision: 1, inFlight: 2, openRequests: 5 }), {}, NOW);

    expect(work).toMatchObject({ decisions: 1, inProgress: 2, queued: 3, tracked: true });
  });
});

describe('a product with nothing tracked says so, not that it is quiet', () => {
  it('reads "No work tracked here" for a product the factory has never built for', () => {
    const meta = productCard(product(1, { slug: 'slate', stage: 'live' }), [], { requests: [], releases: [] }, NOW);

    expect(meta.workNoneLine).toBe('No work tracked here');
    expect(meta.healthLabel).toBe('Health unavailable · Connect monitoring');
    expect(meta.attentionLine).toBeUndefined();
  });

  it('reads "No open work" once work has been tracked and all of it is done', () => {
    const meta = productCard(product(1, SEND), [], { requests: [request(1, { state: 'shipped' })], releases: [] }, NOW);

    expect(meta.workNoneLine).toBe('No open work');
  });
});

describe('the latest release is named by its title', () => {
  it('names the newest release that says what shipped, skipping a bare version', () => {
    const releases = [
      release(10, 'Email delivery tracking and bounce handling', '2026-09-24T04:00:00Z'),
      release(11, 'v1.4.2', '2026-09-24T06:00:00Z'),
      release(12, 'Share button', '2026-09-20T00:00:00Z'),
      release(13, 'Slate thing', '2026-09-24T11:00:00Z', 'slate'),
    ];
    const meta = productCard(product(1, SEND), [], { requests: [], releases }, NOW);

    expect(meta.latestReleaseLine).toBe('Latest: Email delivery tracking and bounce handling');
    expect(meta.latestReleaseId).toBe(10);
    expect(meta.latestReleaseAt).toBe('2026-09-24T04:00:00.000Z');
  });

  it('judges the health check against that release', () => {
    const meta = productCard(product(1, SEND), [], { requests: [], releases: [release(10, 'After the check', '2026-09-24T10:00:00Z')] }, NOW);

    expect(meta.healthLabel).toBe('Health check outdated');
  });
});

describe('every line opens its own place', () => {
  // The templates as templates/plugins/software-factory/pages/products.yaml declares them.
  const ATTENTION = ['/dashboard/p/work?product={meta.slug}#{meta.attentionTab}', '/dashboard/p/products/{id}'];

  it('sends decisions to Work on the Proposed tab for this product, and an issue to the overview', () => {
    const [decide] = deriveProductBoard([product(7, { ...SEND, awaitingDecision: 2 })], { now: NOW });
    const [issue] = deriveProductBoard([product(7, { ...SEND, health: 'down' })], { now: NOW });

    expect(resolveRowActionHref(decide!, ATTENTION)).toBe('/dashboard/p/work?product=send#proposed');
    expect(resolveRowActionHref(issue!, ATTENTION)).toBe('/dashboard/p/products/7');
  });

  it('links in-progress work and the backlog to their tabs, and the latest release to itself', () => {
    const [row] = deriveProductBoard([product(7, SEND)], { now: NOW, requests: [], releases: [release(10, 'Share button', '2026-09-24T04:00:00Z')] });

    expect(interpolateHref(row!, '/dashboard/p/work?product={meta.slug}#in-progress')).toBe('/dashboard/p/work?product=send#in-progress');
    expect(interpolateHref(row!, '/dashboard/objects/{meta.latestReleaseId}')).toBe('/dashboard/objects/10');
  });
});

describe('dependencies read from the board itself', () => {
  it('says what a product is built on, and what is built on it', () => {
    const core = product(1, { slug: 'core' }, 'Squatch Core');
    const send = product(2, { slug: 'send', dependsOn: ['core'] }, 'Send');
    const slate = product(3, { slug: 'slate', dependsOn: ['core'] }, 'Slate');
    const alone = product(4, { slug: 'alone' }, 'Alone');
    const out = deriveProductBoard([core, send, slate, alone], { now: NOW });

    expect(out[0]!.meta.dependencyLine).toBe('Send and Slate build on it');
    expect(out[1]!.meta.dependencyLine).toBe('Built on Squatch Core');
    expect(out[3]!.meta.dependencyLine).toBeUndefined();
  });
});
