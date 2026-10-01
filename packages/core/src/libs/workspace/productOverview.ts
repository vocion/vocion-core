import type { PageRow } from './pageFields';
import type { HealthReading } from './productBoard';
import type { RecordLinker } from './recordHref';
import { groupTabKey } from './pageFields';
import { dependencyLine, healthReading, latestRelease, lifecycleLabel, plural, productWork, releasesFor } from './productBoard';
import { genericRecordLinker } from './recordHref';
import { isWaitingOnPerson } from './workQueue';

/**
 * A PRODUCT'S OVERVIEW, assembled: the page a product card's name opens
 * (`/dashboard/p/products/<id>`), in the order a person running the product
 * asks — what needs me, what are we working towards, what is underway, what
 * shipped, how is it doing, and what do I need to know about it — with the
 * record's machinery (ids, counters, every other field) behind Technical
 * details rather than in front of all of it (products red team, 2026-09-28).
 *
 * Pure over rows, so every section is argued with in a test. It reuses the
 * card's derivation (`productBoard.ts`) and, through it, Work's own
 * (`workQueue.ts`), so "1 change in progress" on the card is the same one
 * change named here and the same one on Work.
 */

export type OverviewLinks = {
  /** Work's slug, for the product's filtered queue; null when there is no Work page. */
  workSlug: string | null;
  /** Releases' slug, for the product's release list. */
  releasesSlug: string | null;
  /**
   * Where one record opens — a request at its feature page, a release at its
   * release page — as the workspace declares it (`recordHref.ts`), so the
   * overview never links a record anywhere its own page does not.
   */
  record: RecordLinker;
};

export type OverviewDecision = {
  id: string | number;
  title: string;
  /** What the product manager recommends, in words: "Build it". */
  recommendation: string | null;
  /** Why it is worth doing, as Work says it. */
  why: string | null;
  /** What happens if it goes ahead — the expected result, and the main risk. */
  consequence: string | null;
  risk: string | null;
  /** Who decides: the product's accountable person. */
  owner: string | null;
  minutes: number | null;
  href: string | null;
};

export type OverviewWork = { id: string | number; title: string; status: string; next: string | null; href: string | null };
export type OverviewRelease = { id: string | number; title: string; at: Date | null; healthAfter: string | null; href: string | null };
export type OverviewFact = { label: string; value: string; href?: string };
/**
 * One place the product runs, as the overview lists it: which part and which
 * stage, where it answers, and what the last deploy left there. The rest of
 * the record (hosting ids, the pipeline step, rollback) is evidence, on the
 * record's own page.
 */
export type OverviewEnvironment = {
  id: string | number;
  /** "API · production" — the surface and stage, or the record's title. */
  name: string;
  url: string | null;
  /** Short commit and when, e.g. "3f2a9c1"; null when no deploy is recorded. */
  deployedSha: string | null;
  deployedAt: Date | null;
  /** The post-deploy check's reading, or null when nothing has checked. */
  health: 'ok' | 'degraded' | 'down' | null;
  /** The run that did the last deploy, one tap from the line. */
  runUrl: string | null;
  /** The last thing the pipeline did here, in one line, or null. */
  line: string | null;
  /** Not answering its health check, in plain words: what, what was tried, who has it. Null while healthy. */
  alert: string | null;
  /** What its answer did not say against its record's `expect` — a note, never the health. */
  advice: string | null;
  href: string;
};

export type ProductOverview = {
  id: string | number;
  name: string;
  slug: string | null;
  tagline: string | null;
  lifecycle: string | null;
  owner: { name: string; email: string } | null;
  appUrl: string | null;
  siteUrl: string | null;
  health: HealthReading;
  attention: {
    decisions: OverviewDecision[];
    blocked: Array<{ id: string | number; title: string; blocker: string | null; href: string | null }>;
    /** Environments not answering their health check, each one line (`healthAlert`). */
    alerts: Array<{ id: string | number; line: string; href: string }>;
    /** What the page cannot see and a person could fix. */
    gaps: string[];
    /** Where every decision for this product is, filtered. */
    reviewHref: string | null;
  };
  focus: string | null;
  work: { inProgress: OverviewWork[]; queued: number; workHref: string | null; backlogHref: string | null };
  releases: { recent: OverviewRelease[]; allHref: string | null };
  /** Where it runs, production first. Empty when none is recorded, and the section is not drawn. */
  environments: OverviewEnvironment[];
  performance: {
    /** Each one says its unit: what was counted, and over when. */
    measures: OverviewFact[];
    /** An actionable line for what is not connected, or null. */
    connect: string | null;
  };
  context: {
    promises: string[];
    ourPrice: string | null;
    incumbent: { name: string | null; plan: string | null; price: string | null; checkedOn: string | null; sourceUrl: string | null } | null;
    builtOn: string | null;
    notes: string | null;
  };
  activity: Array<{ id: string | number; title: string; line: string | null; href: string | null }>;
  technical: { facts: OverviewFact[]; other: OverviewFact[] };
};

function meta(row: PageRow): Record<string, unknown> {
  return row.meta ?? {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') {
    return null;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const RECOMMENDATION: Record<string, string> = {
  build: 'Build it',
  answer: 'Answer it; do not build',
  decline: 'Decline it',
  merge: 'Merge it into an open request',
};

/**
 * Fields the overview draws in its own sections, and so leaves out of
 * "Other fields". Everything else on the record is still reachable there.
 */
const DRAWN = new Set([
  'slug',
  'name',
  'tagline',
  'icon',
  'stage',
  'accountableUser',
  'urls',
  'health',
  'healthSource',
  'healthCheckedAt',
  'currentFocus',
  'promises',
  'ourPrice',
  'incumbent',
  'dependsOn',
  'notes',
  'repos',
  'openRequests',
  'inFlight',
  'awaitingDecision',
  'p1Open',
  'shippedThisMonth',
  'lastReleaseAt',
  'lastShipped',
  'countersUpdatedAt',
  'medianDaysToShip',
  'revenueMonthCents',
]);

function humanKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A value from "Other fields" as one readable line — never JSON with its
 * braces, and never an object's keys run together.
 * @param v - The value.
 */
function readable(v: unknown): string | null {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  if (Array.isArray(v)) {
    const parts = v.map(readable).filter((x): x is string => x !== null);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  const parts = Object.entries(obj(v))
    .map(([k, x]) => {
      const r = readable(x);
      return r === null ? null : `${humanKey(k)} ${r}`;
    })
    .filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Production first, then the stages people share, local last. */
const STAGE_ORDER = ['production', 'staging', 'preview', 'development', 'local'];

const SURFACE_LABEL: Record<string, string> = { api: 'API', web: 'Web app', marketing: 'Marketing site', worker: 'Worker', mobile: 'Mobile', docs: 'Docs' };

/**
 * This product's environments, as the overview lists them.
 * @param slug - The product's slug.
 * @param rows - Every environment record.
 * @param record - Where a record opens in this workspace; the generic record when omitted.
 */
export function environmentsFor(slug: string, rows: PageRow[], record: RecordLinker = genericRecordLinker): OverviewEnvironment[] {
  const rank = (r: PageRow) => {
    const i = STAGE_ORDER.indexOf(String(meta(r).stage ?? ''));
    return i === -1 ? STAGE_ORDER.length : i;
  };
  return rows
    .filter(r => str(meta(r).product) === slug)
    .sort((a, b) => rank(a) - rank(b) || String(meta(a).surface ?? '').localeCompare(String(meta(b).surface ?? '')))
    .map((r) => {
      const m = meta(r);
      const surface = str(m.surface);
      const stage = str(m.stage);
      const name = surface && stage ? `${SURFACE_LABEL[surface] ?? surface} · ${stage}` : r.title;
      const sha = str(m.lastDeployedSha);
      const health = m.lastHealth === 'ok' || m.lastHealth === 'degraded' || m.lastHealth === 'down' ? m.lastHealth : null;
      return {
        id: r.id,
        name,
        url: str(m.url),
        deployedSha: sha ? sha.slice(0, 7) : null,
        deployedAt: toDate(m.lastDeployedAt),
        health,
        runUrl: str(m.lastDeployRunUrl),
        line: str(m.lastPipelineLine),
        alert: healthAlert(name, m),
        advice: str(m.lastHealthAdvice),
        href: record({ objectType: 'environment', id: r.id }),
      };
    });
}

const STEP_WORDS: Record<string, string> = { rerun: 're-ran its failed deploy', redeploy: 'redeployed it', rollback: 'rolled back its last release' };

/**
 * AN UNHEALTHY ENVIRONMENT IS AN ALERT WHERE AN OPERATOR LOOKS (2026-10-01:
 * the health watch's incidents sat on Work as "Stopped after 0 attempts").
 * The line says what is wrong, what its own recovery did, and who has it now.
 * @param name - How the overview names it.
 * @param m - Its metadata (`lastHealth`, `healthRecovery`).
 */
export function healthAlert(name: string, m: Record<string, unknown>): string | null {
  const health = str(m.lastHealth);
  if (health !== 'down' && health !== 'degraded') {
    return null;
  }
  const rec = (m.healthRecovery && typeof m.healthRecovery === 'object' ? m.healthRecovery : {}) as { attempts?: Array<{ kind?: string }>; stoppedAt?: string | null; closedAt?: string | null; askId?: number | null };
  const open = !rec.closedAt;
  const tried = open ? (rec.attempts ?? []).map(a => STEP_WORDS[String(a.kind)] ?? String(a.kind)) : [];
  const what = `${name} is ${health === 'down' ? 'down' : 'answering with errors'}`;
  const did = tried.length > 0 ? `; its own recovery ${tried.join(', then ')}` : '';
  if (open && rec.stoppedAt) {
    return `${what}${did}, and it is still not back. ${rec.askId ? `Ask #${rec.askId} is with a person` : 'A person decides what happens next'}.`;
  }
  return `${what}${did}. It is checked again on the next pass, and recovers by itself before anyone is asked.`;
}

/**
 * Build the overview.
 * @param input - The rows and the clock.
 * @param input.product - The product record, as a row.
 * @param input.products - Every product, for "built on".
 * @param input.requests - Every request (filtered to this product here).
 * @param input.releases - Every release (filtered to this product here).
 * @param input.ownerName - The accountable person's name, when they are a member.
 * @param input.links - Where requests and releases open.
 * @param input.environments - Every environment (filtered to this product here).
 * @param input.now - The clock.
 */
export function buildProductOverview(input: {
  product: PageRow;
  products: PageRow[];
  requests: PageRow[];
  releases: PageRow[];
  ownerName: string | null;
  links: OverviewLinks;
  environments?: PageRow[];
  now: Date;
}): ProductOverview {
  const { product, now, links } = input;
  const m = meta(product);
  const slug = str(m.slug);
  const context = { requests: input.requests, releases: input.releases };
  const latest = latestRelease(product, context);
  const health = healthReading(product, now, latest?.at ?? toDate(m.lastReleaseAt));
  const work = productWork(product, context, now);
  const email = str(m.accountableUser);
  const owner = email ? { name: input.ownerName ?? email, email } : null;
  const urls = obj(m.urls);

  const workBase = links.workSlug && slug ? `/dashboard/p/${links.workSlug}?product=${encodeURIComponent(slug)}` : null;
  const lane = (r: PageRow) => r.meta.laneKey;
  const proposed = work.rows.filter(r => lane(r) === 'proposed');
  const progress = work.rows.filter(r => lane(r) === 'progress');
  const done = work.rows.filter(r => lane(r) === 'done');

  const decisions: OverviewDecision[] = proposed
    .filter(r => isWaitingOnPerson(r) && r.meta.state !== 'Deferred')
    .map((r) => {
      const rm = meta(r);
      const minutes = typeof rm.decisionCost === 'number' ? rm.decisionCost : null;
      const rec = str(rm.recommendedOutcome);
      return {
        id: r.id,
        title: r.title,
        recommendation: rec ? (RECOMMENDATION[rec] ?? rec) : null,
        why: str(rm.whyLine),
        consequence: str(rm.expectedResult),
        risk: str(rm.mainRisk),
        owner: owner?.name ?? null,
        minutes,
        href: links.record({ objectType: 'request', id: r.id }),
      };
    });

  const blocked = progress
    .filter(r => r.meta.state === 'Blocked')
    .map(r => ({ id: r.id, title: r.title, blocker: str(r.meta.blockerLine), href: links.record({ objectType: 'request', id: r.id }) }));

  const gaps: string[] = [];
  if (health.state === 'unavailable' || health.state === 'outdated') {
    gaps.push(health.detail);
  }
  if (!owner) {
    gaps.push('No one is recorded as accountable for this product, so decisions about it have no owner.');
  }
  if (!work.tracked) {
    gaps.push('No work for this product is tracked in the factory, so what is underway cannot be shown here.');
  }

  const mine = slug ? releasesFor(product, input.releases) : [];
  const recent: OverviewRelease[] = mine.slice(0, 5).map(r => ({
    id: r.id,
    title: r.title,
    at: toDate(r.meta.releasedAt) ?? r.createdAt,
    healthAfter: str(r.meta.healthAfter),
    href: links.record({ objectType: 'release', id: r.id }),
  }));

  const environments = slug ? environmentsFor(slug, input.environments ?? [], links.record) : [];

  // Performance says its unit on every figure. A release here is a deploy
  // that reached people (releases.yaml), so "releases this month" counts
  // deployments, and it is counted from the records, not a stored counter.
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const thisMonth = mine.filter(r => (toDate(r.meta.releasedAt)?.getTime() ?? 0) >= monthStart).length;
  const shipped = done.filter(r => String(r.meta.state).startsWith('Shipped')).length;
  const measures: OverviewFact[] = [];
  if (work.tracked) {
    measures.push({ label: 'Releases this month', value: `${plural(thisMonth, 'release')} deployed since ${new Date(monthStart).toISOString().slice(0, 10)}` });
    measures.push({ label: 'Requests shipped', value: `${plural(shipped, 'request')} shipped in the last 14 days` });
  }
  const revenue = typeof m.revenueMonthCents === 'number' ? m.revenueMonthCents : null;
  if (revenue !== null) {
    measures.push({ label: 'Revenue this month', value: `$${(revenue / 100).toFixed(2)}` });
  }
  const connect = revenue === null
    ? 'Usage and revenue are not connected, so how people use this product cannot be shown. Connect analytics or billing to measure it.'
    : null;

  const incumbent = obj(m.incumbent);
  const hasIncumbent = Object.keys(incumbent).length > 0;

  const facts: OverviewFact[] = [];
  const add = (label: string, value: string | null, href?: string) => {
    if (value) {
      facts.push(href ? { label, value, href } : { label, value });
    }
  };
  add('Slug', slug);
  add('Record', `#${product.id}`);
  add('Repositories', strings(m.repos).join(', ') || null);
  add('API', str(urls.api), str(urls.api) ?? undefined);
  add('Health source', str(m.healthSource));
  add('Health checked', str(m.healthCheckedAt));
  add('Open requests (counter)', typeof m.openRequests === 'number' ? String(m.openRequests) : null);
  add('Being worked on (counter)', typeof m.inFlight === 'number' ? String(m.inFlight) : null);
  add('Awaiting a decision (counter)', typeof m.awaitingDecision === 'number' ? String(m.awaitingDecision) : null);
  add('Open P1s (counter)', typeof m.p1Open === 'number' ? String(m.p1Open) : null);
  // "23 shipped this month" said nothing about WHAT shipped 23 times. It is
  // the stored count of release records — deployments — not features.
  add('Deployments this month (stored counter)', typeof m.shippedThisMonth === 'number' ? `${plural(m.shippedThisMonth, 'release')} (deployments, not features)` : null);
  add('Counters as of', str(m.countersUpdatedAt));

  const other: OverviewFact[] = Object.entries(m)
    .filter(([k]) => !DRAWN.has(k))
    // The card's own derived lines are not fields of the record.
    .filter(([k]) => !/^(?:lifecycle|health(?:State|Label|Tone)|attention|inProgressLine|backlogLine|workNoneLine|latestRelease|dependencyLine)/.test(k))
    .map(([k, v]) => ({ label: humanKey(k), value: readable(v) }))
    .filter((f): f is OverviewFact => f.value !== null);

  return {
    id: product.id,
    name: product.title,
    slug,
    tagline: str(m.tagline),
    lifecycle: lifecycleLabel(product),
    owner,
    appUrl: str(urls.app),
    siteUrl: str(urls.site),
    health,
    attention: {
      decisions,
      blocked,
      alerts: environments.flatMap(e => (e.alert ? [{ id: e.id, line: e.alert, href: e.href }] : [])),
      gaps,
      reviewHref: workBase ? `${workBase}#${groupTabKey('Proposed')}` : null,
    },
    focus: str(m.currentFocus),
    work: {
      inProgress: progress.map(r => ({ id: r.id, title: r.title, status: String(r.meta.state ?? ''), next: str(r.meta.workLine), href: links.record({ objectType: 'request', id: r.id }) })),
      queued: work.queued,
      workHref: workBase ? `${workBase}#${groupTabKey('In progress')}` : null,
      backlogHref: workBase ? `${workBase}#${groupTabKey('Proposed')}` : null,
    },
    releases: {
      recent,
      allHref: links.releasesSlug && slug ? `/dashboard/p/${links.releasesSlug}?product=${encodeURIComponent(slug)}` : null,
    },
    environments,
    performance: { measures, connect },
    context: {
      promises: strings(m.promises),
      ourPrice: str(m.ourPrice),
      incumbent: hasIncumbent
        ? { name: str(incumbent.name), plan: str(incumbent.comparePlan), price: str(incumbent.listPrice), checkedOn: str(incumbent.checkedOn), sourceUrl: str(incumbent.sourceUrl) }
        : null,
      builtOn: dependencyLine(product, input.products),
      notes: str(m.notes),
    },
    activity: done.slice(0, 8).map(r => ({ id: r.id, title: r.title, line: str(r.meta.workLine), href: links.record({ objectType: 'request', id: r.id }) })),
    technical: { facts, other },
  };
}
