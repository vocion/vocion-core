import type { PageRow } from './pageFields';
import type { HealthReading } from './productBoard';
import type { RecordLinker } from './recordHref';
import type { ReleaseLinked } from './releaseFeed';
import { projectIssuesUrl } from '@/libs/sentry/client';
import { sentryRefOf } from '@/libs/sentry/reference';
import { groupTabKey } from './pageFields';
import { dependencyLine, healthReading, latestRelease, lifecycleLabel, plural, productWork, releasesFor } from './productBoard';
import { genericRecordLinker } from './recordHref';
import { readRelease } from './releaseFeed';
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
  /**
   * The object type of each role, as the plugin names them
   * (`libs/factory/types.ts`), so a link names the type the workspace
   * declared rather than one written here. Absent, the factory's defaults.
   */
  types?: Partial<Record<'request' | 'release' | 'environment' | 'repo', string>>;
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
export type OverviewRelease = {
  id: string | number;
  title: string;
  at: Date | null;
  healthAfter: string | null;
  /** Whether QA saw it on the live product, in one line ("Seen live: 3 of 4 reached"). */
  live: { line: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } | null;
  href: string | null;
};
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
  /** Whether a QA sign-in is stored for it (never the secret); null when the record does not say. */
  qaSignIn: boolean | null;
  /** How it deploys: the workflow, its step, and the workflow's page. */
  deploy: { workflow: string | null; step: string | null; url: string | null } | null;
  /** When its health was last checked. */
  checkedAt: Date | null;
  /**
   * Where its errors are tracked (`observability.sentry`): the project, its
   * open issues in the last 24 hours (null when they could not be read, with
   * why), and the tracker's own page for them.
   */
  errors: { label: string; environment: string | null; href: string; open24h: number | null; unread: string | null } | null;
  href: string;
};

/**
 * One figure on "How it is doing": what was counted, over the last 30 days,
 * and how it moved against the 30 before — every metric carries its
 * direction (Chris, 2026-09-22). `better` says which way is good, so the
 * arrow is coloured by meaning rather than by sign; null when neither is.
 */
export type OverviewMeasure = {
  key: string;
  label: string;
  value: string;
  change: { line: string; tone: 'ok' | 'bad' | 'muted' } | null;
  /** What it counts, for the tooltip. */
  hint: string;
};

/** One thing that needs a person, in one line, with the move. */
export type OverviewNeed = {
  key: string;
  line: string;
  tone: 'bad' | 'warn';
  action: { label: string; href: string } | null;
};

/** A proposal, compact: its name, why in one line, and Build or Dismiss. */
export type OverviewProposal = {
  id: string | number;
  title: string;
  why: string | null;
  href: string | null;
  /** A Build card already waiting for it: pressing Build approves that card. */
  pendingRunId: number | null;
  /** Why a build would be refused now (its blocker), drawn as the disabled button's tooltip. */
  blocked: string | null;
};

/** A picture of the product: a mockup of work underway, or what QA saw live. */
export type OverviewPicture = {
  artifactId: number;
  label: 'Mockup' | 'Live';
  caption: string;
  /** Who or what it came from, and where it opens. */
  source: { text: string; ref: { type: 'object'; id: string } };
};

/** A repository that makes the product, as the Release engineer reads it. */
export type OverviewRepo = {
  id: string | number;
  name: string;
  url: string | null;
  branch: string | null;
  checks: string[];
  /** The paths in it that are this product's (`productPaths[<slug>]`). */
  paths: string[];
  href: string;
};

/** A pipeline fact the Release engineer acts on: an open change, a fix it was asked for. */
export type OverviewPipelineItem = {
  key: string;
  line: string;
  tone: 'bad' | 'warn' | 'muted';
  href: string | null;
  external: boolean;
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
  /** Live health in one line, from the production environments' own checks. */
  liveHealth: { tone: 'ok' | 'warn' | 'bad' | 'muted'; line: string };
  /** How it is doing: each figure with its direction. */
  measures: OverviewMeasure[];
  /** What needs a person, one line each with the move. */
  needs: OverviewNeed[];
  /** Proposals waiting for a decision, compact, best first. */
  proposals: { shown: OverviewProposal[]; more: number; href: string | null };
  /** Pictures of the product, newest work first. */
  pictures: OverviewPicture[];
  /** How it ships — the Release engineer's view, folded on the page. */
  engineering: { repos: OverviewRepo[]; pipeline: OverviewPipelineItem[]; summary: string };
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
 * @param objectType - The environment type's slug, as the plugin names it.
 */
export function environmentsFor(slug: string, rows: PageRow[], record: RecordLinker = genericRecordLinker, objectType = 'environment'): OverviewEnvironment[] {
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
        qaSignIn: 'qaLoginCredentialId' in m ? str(m.qaLoginCredentialId) !== null || typeof m.qaLoginCredentialId === 'number' : null,
        deploy: deployOf(m.deploy),
        checkedAt: toDate(m.lastHealthCheckedAt),
        errors: errorsOf(m),
        href: record({ objectType, id: r.id }),
      };
    });
}

/**
 * Where an environment's errors are tracked, before its count is read.
 * @param m - Its metadata.
 */
function errorsOf(m: Record<string, unknown>): OverviewEnvironment['errors'] {
  const ref = sentryRefOf(m);
  return ref ? { label: `${ref.org}/${ref.project}`, environment: ref.environment, href: projectIssuesUrl(ref), open24h: null, unread: null } : null;
}

function deployOf(v: unknown): OverviewEnvironment['deploy'] {
  const d = obj(v);
  const workflow = str(d.workflow);
  const step = str(d.step);
  const url = str(d.workflowUrl);
  return workflow || step || url ? { workflow, step, url } : null;
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

const DAY_MS = 86_400_000;
/** The window every measure counts over, and compares with the one before it. */
export const MEASURE_WINDOW_DAYS = 30;

/**
 * "↑ 3 vs prior 30 days", coloured by whether up is good.
 * @param now - This window's figure.
 * @param before - The prior window's.
 * @param better - Which way is good, or null.
 * @param unit - What a difference of one is, when it is not a count ("d").
 */
export function changeOf(now: number, before: number, better: 'up' | 'down' | null, unit = ''): OverviewMeasure['change'] {
  const d = Math.round((now - before) * 10) / 10;
  if (d === 0) {
    return { line: `same as prior ${MEASURE_WINDOW_DAYS} days`, tone: 'muted' };
  }
  const up = d > 0;
  const tone = better === null ? 'muted' : (up === (better === 'up') ? 'ok' : 'bad');
  return { line: `${up ? '↑' : '↓'} ${Math.abs(d)}${unit} vs prior ${MEASURE_WINDOW_DAYS} days`, tone };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) {
    return null;
  }
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * The figures on "How it is doing", over the last 30 days against the 30
 * before: releases deployed, features shipped, the median days from ask to
 * shipped, and how many releases QA saw working on the live product.
 * @param input - What to count.
 * @param input.releases - This product's release records.
 * @param input.requests - This product's request records.
 * @param input.live - Each release's live-check state, by id.
 * @param input.now - The clock.
 */
export function measuresOf(input: { releases: PageRow[]; requests: PageRow[]; live: Map<string, string>; now: Date }): OverviewMeasure[] {
  const end = input.now.getTime();
  const w = MEASURE_WINDOW_DAYS * DAY_MS;
  const inWindow = (t: number | null, k: 0 | 1) => t !== null && t <= end - k * w && t > end - (k + 1) * w;
  const at = (r: PageRow, key: string) => toDate(meta(r)[key])?.getTime() ?? null;
  const released = (k: 0 | 1) => input.releases.filter(r => inWindow(at(r, 'releasedAt') ?? r.createdAt?.getTime() ?? null, k));
  const shipped = (k: 0 | 1) => input.requests.filter(r => inWindow(at(r, 'shippedAt'), k));
  const days = (k: 0 | 1) => median(shipped(k).flatMap((r) => {
    const from = r.createdAt?.getTime();
    const to = at(r, 'shippedAt');
    return from && to && to >= from ? [(to - from) / DAY_MS] : [];
  }));
  const out: OverviewMeasure[] = [];
  const [r0, r1] = [released(0).length, released(1).length];
  out.push({ key: 'releases', label: 'Releases', value: String(r0), change: changeOf(r0, r1, 'up'), hint: `Deploys that reached people in the last ${MEASURE_WINDOW_DAYS} days` });
  const [s0, s1] = [shipped(0).length, shipped(1).length];
  out.push({ key: 'shipped', label: 'Features shipped', value: String(s0), change: changeOf(s0, s1, 'up'), hint: `Requests shipped in the last ${MEASURE_WINDOW_DAYS} days` });
  const [d0, d1] = [days(0), days(1)];
  if (d0 !== null) {
    const round = (x: number) => Math.round(x * 10) / 10;
    out.push({ key: 'days', label: 'Ask to shipped', value: `${round(d0)}d`, change: d1 === null ? null : changeOf(round(d0), round(d1), 'down', 'd'), hint: 'Median days from a request being filed to it shipping' });
  }
  const checked = (k: 0 | 1) => released(k).filter(r => ['seen', 'partial', 'not_seen'].includes(input.live.get(String(r.id)) ?? ''));
  const seen = (k: 0 | 1) => checked(k).filter(r => input.live.get(String(r.id)) === 'seen').length;
  const c0 = checked(0).length;
  if (c0 > 0) {
    const c1 = checked(1).length;
    const pct = (k: 0 | 1, n: number) => (n === 0 ? 0 : Math.round((seen(k) / n) * 100));
    out.push({ key: 'live', label: 'Seen working live', value: `${seen(0)} of ${c0}`, change: c1 === 0 ? null : changeOf(pct(0, c0), pct(1, c1), 'up', '%'), hint: 'Releases QA checked on the live product, signed in as its QA account, that did what they said' });
  }
  return out;
}

/**
 * Live health in one line, from what the production environments' own
 * checks last said; the product's stored reading only when none is recorded.
 * @param envs - This product's environments.
 * @param fallback - The product's health reading.
 * @param now - The clock.
 */
export function liveHealthOf(envs: OverviewEnvironment[], fallback: HealthReading, now: Date): ProductOverview['liveHealth'] {
  const prod = envs.filter(e => e.health !== null && e.url !== null);
  if (prod.length === 0) {
    return { tone: fallback.tone === 'ok' ? 'ok' : fallback.tone === 'bad' ? 'bad' : fallback.tone === 'warn' ? 'warn' : 'muted', line: fallback.label };
  }
  const down = prod.filter(e => e.health === 'down');
  const degraded = prod.filter(e => e.health === 'degraded');
  const newest = Math.max(...prod.map(e => e.checkedAt?.getTime() ?? 0));
  const ago = newest > 0 ? relativeShort(now.getTime() - newest) : null;
  const when = ago ? ` · checked ${ago}` : '';
  if (down.length > 0) {
    return { tone: 'bad', line: `${down.map(e => e.name).join(', ')} down${when}` };
  }
  if (degraded.length > 0) {
    return { tone: 'warn', line: `${degraded.map(e => e.name).join(', ')} answering with errors${when}` };
  }
  return { tone: 'ok', line: `${prod.length === 1 ? 'Live and answering' : `All ${prod.length} live surfaces answering`}${when}` };
}

function relativeShort(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) {
    return 'just now';
  }
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/**
 * The repositories that make it, as the Release engineer reads them.
 * @param slug - The product's slug.
 * @param rows - Every repository record.
 * @param record - Where a record opens.
 * @param objectType - The repository type's slug.
 */
export function reposFor(slug: string, rows: PageRow[], record: RecordLinker, objectType: string): OverviewRepo[] {
  return rows
    .filter(r => str(meta(r).product) === slug || Object.keys(obj(meta(r).productPaths)).some(k => k === slug || k.startsWith(`${slug}.`)))
    .map((r) => {
      const m = meta(r);
      const checks = Array.isArray(m.checks) ? m.checks.flatMap(c => (typeof c === 'string' ? [c] : str(obj(c).name) ? [str(obj(c).name)!] : [])) : [];
      const paths = strings(obj(m.productPaths)[slug]);
      return { id: r.id, name: r.title, url: str(m.url), branch: str(m.defaultBranch), checks, paths, href: record({ objectType, id: r.id }) };
    });
}

/**
 * What the pipeline is doing for this product that a person may want to see:
 * each open pipeline change (a pull request the Release engineer opened, on
 * its record), and each fix it was asked for — who has it, which attempt, or
 * the ask it stopped on. Read from the records' own `pipelineChange` and
 * `pipelineWork`, never from their words.
 * @param records - This product's environments, repositories and requests.
 */
export function pipelineOf(records: Array<{ row: PageRow; href: string }>): OverviewPipelineItem[] {
  const out: OverviewPipelineItem[] = [];
  for (const { row, href } of records) {
    const m = meta(row);
    const change = obj(m.pipelineChange);
    const url = str(change.url);
    if (url && str(change.state) === 'open') {
      const by = str(change.by)?.replace(/^agent:/, '');
      out.push({ key: `change:${row.id}`, line: `Pipeline change open for ${row.title}: ${str(change.title) ?? url.replace('https://github.com/', '')}${by ? ` · by ${by}` : ''} · merges itself on green`, tone: 'warn', href: url, external: true });
    }
    const work = obj(m.pipelineWork);
    if (typeof work.attempt === 'number') {
      const who = str(work.owner) ?? 'The pipeline\'s owner';
      const stopped = str(work.stoppedAt);
      out.push({
        key: `work:${row.id}`,
        line: stopped
          ? `${row.title}: the pipeline fix stopped after ${work.attempt} attempt${work.attempt === 1 ? '' : 's'}${typeof work.askId === 'number' ? `; ask #${work.askId} is with a person` : ''}`
          : `${row.title}: ${who} is fixing the pipeline (attempt ${work.attempt})${str(work.cause) ? ` · ${str(work.cause)}` : ''}`,
        tone: stopped ? 'bad' : 'warn',
        href,
        external: false,
      });
    }
  }
  return out;
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
 * @param input.repos - Every repository (filtered to this product here).
 * @param input.work - The work queue's own reading, when the caller has it.
 * @param input.work.tasks - The engineering tasks.
 * @param input.work.live - What is running for each record now.
 * @param input.work.pendingBuilds - Build cards waiting on a person.
 * @param input.releaseLinked - What each release names.
 * @param input.timeZone - The workspace's zone.
 * @param input.paused - How many of the plugin's automations are paused.
 * @param input.errorCounts - Each environment's open error-tracking issues, read by the loader.
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
  /** Every repository record (filtered to this product here). */
  repos?: PageRow[];
  /** The work queue's own reading, when the caller has it: tasks, live runs, Build cards. */
  work?: { tasks?: PageRow[]; live?: ReadonlyMap<number, import('@/libs/factory/liveStatus').LiveRun | null>; pendingBuilds?: Array<{ requestId: number; runId: number; at: Date | null }> };
  /** What each release names, for its headline and its live check (`releaseFeed.readRelease`). */
  releaseLinked?: ReleaseLinked;
  timeZone?: string;
  /** How many of the plugin's automations are paused. */
  paused?: number;
  /** Each environment's open error-tracking issues in the last 24 hours, by record id, as the loader read them. */
  errorCounts?: ReadonlyMap<string, { open24h: number | null; unread: string | null }>;
  now: Date;
}): ProductOverview {
  const { product, now, links } = input;
  const T = { request: 'request', release: 'release', environment: 'environment', repo: 'repo', ...links.types };
  const m = meta(product);
  const slug = str(m.slug);
  const context = { requests: input.requests, releases: input.releases };
  const latest = latestRelease(product, context);
  const health = healthReading(product, now, latest?.at ?? toDate(m.lastReleaseAt));
  const work = productWork(product, context, now, input.work);
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
        href: links.record({ objectType: T.request, id: r.id }),
      };
    });

  const blocked = progress
    .filter(r => r.meta.state === 'Blocked')
    .map(r => ({ id: r.id, title: r.title, blocker: str(r.meta.blockerLine), href: links.record({ objectType: T.request, id: r.id }) }));

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
  // RELEASES READ AS THE RELEASES PAGE READS THEM: the headline people
  // would recognise, and whether QA saw it working live.
  const readings = new Map(mine.slice(0, 60).map(r => [String(r.id), readRelease(r, { linked: input.releaseLinked, now, timeZone: input.timeZone })]));
  const recent: OverviewRelease[] = mine.slice(0, 5).map(r => ({
    id: r.id,
    // What changed, in the product's words, when the release names a change;
    // its short name, else the record's own title, when it names none.
    title: (() => {
      const read = readings.get(String(r.id));
      return read && read.features.length + read.otherChanges.length > 0 ? read.headline : (str(r.meta.name) ?? r.title);
    })(),
    at: toDate(r.meta.releasedAt) ?? r.createdAt,
    healthAfter: str(r.meta.healthAfter),
    live: (() => {
      const l = readings.get(String(r.id))?.verification.live;
      return l && l.state !== 'none' ? { line: l.line, tone: l.tone } : null;
    })(),
    href: links.record({ objectType: T.release, id: r.id }),
  }));

  const environments = (slug ? environmentsFor(slug, input.environments ?? [], links.record, T.environment) : [])
    .map((e) => {
      const read = input.errorCounts?.get(String(e.id));
      return e.errors && read ? { ...e, errors: { ...e.errors, ...read } } : e;
    });

  const liveStates = new Map([...readings].map(([id, r]) => [id, r.verification.live.state]));
  const mineRequests = slug ? input.requests.filter(r => str(meta(r).product) === slug) : [];
  const measuresWithDirection = work.tracked ? measuresOf({ releases: mine, requests: mineRequests, live: liveStates, now }) : [];

  // PROPOSALS, compact: best first as Work ranks them, Build or Dismiss.
  const deciding = decisions.length;
  const proposalRows = proposed.filter(r => isWaitingOnPerson(r) && r.meta.state !== 'Deferred');
  const builds = new Map((input.work?.pendingBuilds ?? []).map(b => [b.requestId, b.runId]));
  const PROPOSALS_SHOWN = 5;
  const proposals: OverviewProposal[] = proposalRows.slice(0, PROPOSALS_SHOWN).map(r => ({
    id: r.id,
    title: r.title,
    why: str(r.meta.whyLine) ?? str(r.meta.problem),
    href: links.record({ objectType: T.request, id: r.id }),
    pendingRunId: builds.get(Number(r.id)) ?? null,
    blocked: str(r.meta.blockerLine),
  }));

  // WHAT NEEDS A PERSON, one line each with the move. Proposals are said
  // once, as a count with its move; each one is in Proposed below.
  const needs: OverviewNeed[] = [];
  for (const e of environments) {
    if (e.alert) {
      needs.push({ key: `env:${e.id}`, line: e.alert, tone: 'bad', action: { label: 'Open', href: e.href } });
    }
  }
  for (const r of progress) {
    const href = links.record({ objectType: T.request, id: r.id });
    if (r.meta.state === 'Blocked') {
      needs.push({ key: `blocked:${r.id}`, line: `${r.title} is blocked${str(r.meta.blockerLine) ? ` on ${str(r.meta.blockerLine)}` : ''}`, tone: 'bad', action: href ? { label: 'Unblock', href } : null });
    } else if (r.meta.needsYou) {
      needs.push({ key: `you:${r.id}`, line: `${r.title}: ${str(r.meta.workLine) ?? 'waiting for you'}`, tone: 'warn', action: href ? { label: 'Open', href } : null });
    }
  }
  if (deciding > 0) {
    needs.push({ key: 'proposals', line: `${plural(deciding, 'proposal')} waiting for your decision`, tone: 'warn', action: { label: 'Decide', href: '#proposed' } });
  }
  if ((input.paused ?? 0) > 0) {
    needs.push({ key: 'paused', line: `${plural(input.paused!, 'automation')} paused: what ${input.paused === 1 ? 'it does' : 'they do'} is not happening`, tone: 'warn', action: { label: 'See', href: '#engineering' } });
  }
  if (!owner) {
    needs.push({ key: 'owner', line: 'No one is accountable for this product, so its decisions have no owner', tone: 'warn', action: { label: 'Set owner', href: `/dashboard/objects/${product.id}` } });
  }

  // PICTURES: a mockup for each piece of work in flight or proposed, then
  // what QA saw on the live product for the newest releases.
  const pictures: OverviewPicture[] = [];
  for (const r of [...progress, ...proposalRows]) {
    const id = typeof r.meta.visual === 'number' ? r.meta.visual : null;
    if (id) {
      pictures.push({ artifactId: id, label: 'Mockup', caption: r.title, source: { text: `Request #${r.id}`, ref: { type: 'object', id: String(r.id) } } });
    }
  }
  for (const r of mine.slice(0, 5)) {
    const head = recent.find(x => x.id === r.id)?.title ?? r.title;
    const shots = Array.isArray(r.meta.liveEvidence) ? r.meta.liveEvidence as Array<Record<string, unknown>> : [];
    const shot = shots.find(e => e.status === 'reached' && Number.isInteger(Number(e.artifactId)) && Number(e.artifactId) > 0);
    const image = shot ? Number(shot.artifactId) : (Number.isInteger(r.meta.announcementImageArtifactId) ? r.meta.announcementImageArtifactId as number : null);
    if (image) {
      pictures.push({ artifactId: image, label: 'Live', caption: shot ? (str(shot.criterion) ?? head) : head, source: { text: head, ref: { type: 'object', id: String(r.id) } } });
    }
  }

  // HOW IT SHIPS, for the Release engineer.
  const repos = slug ? reposFor(slug, input.repos ?? [], links.record, T.repo) : [];
  const envRows = slug ? (input.environments ?? []).filter(r => str(meta(r).product) === slug) : [];
  const repoRows = (input.repos ?? []).filter(r => repos.some(x => x.id === r.id));
  const pipeline = pipelineOf([
    ...envRows.map(r => ({ row: r, href: links.record({ objectType: T.environment, id: r.id }) })),
    ...repoRows.map(r => ({ row: r, href: links.record({ objectType: T.repo, id: r.id }) })),
    ...mineRequests.filter(r => lane(work.rows.find(w => w.id === r.id) ?? r) !== 'done').map(r => ({ row: r, href: links.record({ objectType: T.request, id: r.id }) ?? `/dashboard/objects/${r.id}` })),
  ]);
  const workflows = [...new Set(environments.flatMap(e => (e.deploy?.workflow ? [e.deploy.workflow] : [])))];
  const engineeringSummary = [
    environments.length > 0 ? plural(environments.length, 'environment') : null,
    repos.length > 0 ? plural(repos.length, 'repository', 'repositories') : null,
    workflows.length > 0 ? `deploys by ${workflows.join(', ')}` : null,
    pipeline.length > 0 ? plural(pipeline.length, 'pipeline item') : null,
    (input.paused ?? 0) > 0 ? `${plural(input.paused!, 'automation')} paused` : null,
  ].filter(Boolean).join(' · ');

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
    liveHealth: liveHealthOf(environments, health, now),
    measures: measuresWithDirection,
    needs,
    proposals: { shown: proposals, more: Math.max(0, proposalRows.length - proposals.length), href: workBase ? `${workBase}#${groupTabKey('Proposed')}` : null },
    pictures,
    engineering: { repos, pipeline, summary: engineeringSummary },
    attention: {
      decisions,
      blocked,
      alerts: environments.flatMap(e => (e.alert ? [{ id: e.id, line: e.alert, href: e.href }] : [])),
      gaps,
      reviewHref: workBase ? `${workBase}#${groupTabKey('Proposed')}` : null,
    },
    focus: str(m.currentFocus),
    work: {
      inProgress: progress.map(r => ({ id: r.id, title: r.title, status: String(r.meta.state ?? ''), next: str(r.meta.workLine), href: links.record({ objectType: T.request, id: r.id }) })),
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
    activity: done.slice(0, 8).map(r => ({ id: r.id, title: r.title, line: str(r.meta.workLine), href: links.record({ objectType: T.request, id: r.id }) })),
    technical: { facts, other },
  };
}
