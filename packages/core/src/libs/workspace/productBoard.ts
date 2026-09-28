import type { PageRow } from './pageFields';
import { groupTabKey } from './pageFields';
import { deriveWorkQueue, isWaitingOnPerson } from './workQueue';

/**
 * THE PRODUCT CARD, derived. A card answers, in this order: what is it, what
 * needs me, what is underway, what last shipped, and — quietly — where it is
 * in its life and whether anything is watching it (products red team,
 * 2026-09-28).
 *
 * Three axes that used to share one line and must not:
 *
 * - **Lifecycle** — Internal testing, Beta, Live, Retired. Where the product
 *   is in its life. Neutral: "dogfood" is not a warning.
 * - **Operational health** — whether the last check passed, found an issue,
 *   is too old to count, or whether nothing is checking at all. A check older
 *   than the latest release, or than {@link HEALTH_FRESH_HOURS}, is never
 *   drawn as "ok": it says "Health check outdated".
 * - **Work attention** — the ONE thing a person should do here. "Review 2
 *   decisions", never both "Waiting on you: 2 decisions" and "2 to decide".
 *
 * Read from the request and release records themselves when the page hands
 * them over, and from the product's rollups when it does not, so the card
 * and the product's overview count the same thing the same way.
 */

/** How old a health check may be and still count as current. */
export const HEALTH_FRESH_HOURS = 48;

/** The request/release rows a card is derived from, when the page loaded them. */
export type ProductBoardContext = { requests?: PageRow[]; releases?: PageRow[] };

function num(row: PageRow, key: string): number {
  const v = (row.meta ?? {})[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(row: PageRow, key: string): string | null {
  const v = (row.meta ?? {})[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function date(row: PageRow, key: string): Date | null {
  const v = (row.meta ?? {})[key];
  if (typeof v !== 'string' && typeof v !== 'number') {
    return null;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function plural(n: number, noun: string, many = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : many}`;
}

function list(row: PageRow, key: string): string[] {
  const v = (row.meta ?? {})[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : [];
}

function names(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Lifecycle, in the words a person running a product uses. */
const LIFECYCLE: Record<string, string> = {
  idea: 'Idea',
  building: 'In development',
  dogfood: 'Internal testing',
  beta: 'Beta',
  live: 'Live',
  retired: 'Retired',
};

/**
 * Where the product is in its life, as a label. Never a tone: a stage is not
 * a state of alarm.
 * @param row - The product.
 */
export function lifecycleLabel(row: PageRow): string | null {
  const stage = str(row, 'stage');
  return stage ? (LIFECYCLE[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1)) : null;
}

export type HealthState = 'passed' | 'issue' | 'outdated' | 'unavailable';

export type HealthReading = {
  state: HealthState;
  /** What the card says. */
  label: string;
  /** The dot's tone. */
  tone: 'ok' | 'bad' | 'warn' | 'muted';
  /** Why, in a sentence the overview can show beside it. */
  detail: string;
  checkedAt: Date | null;
  source: string | null;
};

/**
 * Operational health, as a reading that can be checked. A product nothing
 * watches is "unavailable", which names our gap; a product whose check is
 * older than its latest release, or than {@link HEALTH_FRESH_HOURS}, is
 * "outdated" whatever that check said — an "ok" from before the last deploy
 * is not about the product people are using now. An issue is never hidden
 * for being old: it stays an issue until a check says otherwise.
 * @param row - The product.
 * @param now - The clock.
 * @param latestReleaseAt - When the product last shipped, if known.
 */
export function healthReading(row: PageRow, now: Date, latestReleaseAt: Date | null = date(row, 'lastReleaseAt')): HealthReading {
  const health = str(row, 'health');
  const source = str(row, 'healthSource');
  const checkedAt = date(row, 'healthCheckedAt');
  if (!source && !checkedAt) {
    return { state: 'unavailable', label: 'Health unavailable · Connect monitoring', tone: 'muted', detail: 'Nothing is checking this product, so there is no health reading.', checkedAt: null, source: null };
  }
  const when = checkedAt ? checkedAt.toISOString().slice(0, 10) : null;
  if (health === 'down' || health === 'degraded') {
    return { state: 'issue', label: 'Issue detected', tone: 'bad', detail: `The last check${source ? ` (${source})` : ''} found it ${health}${when ? ` on ${when}` : ''}.`, checkedAt, source };
  }
  const ageHours = checkedAt ? (now.getTime() - checkedAt.getTime()) / 3_600_000 : Number.POSITIVE_INFINITY;
  if (!checkedAt || health !== 'ok') {
    return { state: 'outdated', label: 'Health check outdated', tone: 'warn', detail: `${source ?? 'A check'} is connected but has no current reading.`, checkedAt, source };
  }
  if (latestReleaseAt && checkedAt.getTime() < latestReleaseAt.getTime()) {
    return { state: 'outdated', label: 'Health check outdated', tone: 'warn', detail: `The last check (${when}) ran before the latest release, so it says nothing about what people are using now.`, checkedAt, source };
  }
  if (ageHours > HEALTH_FRESH_HOURS) {
    return { state: 'outdated', label: 'Health check outdated', tone: 'warn', detail: `The last check ran on ${when}, more than ${HEALTH_FRESH_HOURS} hours ago.`, checkedAt, source };
  }
  return { state: 'passed', label: 'Current checks passed', tone: 'ok', detail: `${source ?? 'The check'} passed${when ? ` on ${when}` : ''}, after the latest release.`, checkedAt, source };
}

/** One product's requests, read the way Work reads them. */
export type ProductWork = {
  /** Work's derived rows for this product, every lane, uncapped. */
  rows: PageRow[];
  decisions: number;
  inProgress: number;
  blocked: number;
  /** Owed and not started: Work's Proposed lane, decisions included. */
  queued: number;
  /** Whether this product has ever had work tracked in the factory. */
  tracked: boolean;
};

/**
 * The requests that belong to a product.
 * @param product - The product.
 * @param requests - Every request.
 */
export function requestsFor(product: PageRow, requests: PageRow[]): PageRow[] {
  const slug = str(product, 'slug');
  return slug ? requests.filter(r => str(r, 'product') === slug) : [];
}

/**
 * The releases that belong to a product, newest first.
 * @param product - The product.
 * @param releases - Every release.
 */
export function releasesFor(product: PageRow, releases: PageRow[]): PageRow[] {
  const slug = str(product, 'slug');
  const at = (r: PageRow) => date(r, 'releasedAt')?.getTime() ?? r.createdAt?.getTime() ?? 0;
  return slug ? releases.filter(r => str(r, 'product') === slug).sort((a, b) => at(b) - at(a)) : [];
}

/**
 * What a product has underway, from its requests through Work's own
 * derivation (so "in progress" here is "In progress" there), or from the
 * product's rollups when the requests were not loaded.
 * @param product - The product.
 * @param context - Requests and releases, when loaded.
 * @param now - The clock.
 */
export function productWork(product: PageRow, context: ProductBoardContext, now: Date): ProductWork {
  if (!context.requests) {
    const inProgress = num(product, 'inFlight');
    const open = num(product, 'openRequests');
    return {
      rows: [],
      decisions: num(product, 'awaitingDecision'),
      inProgress,
      blocked: 0,
      queued: Math.max(0, open - inProgress),
      tracked: open > 0 || date(product, 'lastReleaseAt') !== null,
    };
  }
  const mine = requestsFor(product, context.requests);
  const rows = deriveWorkQueue(mine, { now, proposedShown: Number.POSITIVE_INFINITY, doneShown: Number.POSITIVE_INFINITY, decideShown: Number.POSITIVE_INFINITY });
  const lane = (r: PageRow) => r.meta.laneKey;
  const proposed = rows.filter(r => lane(r) === 'proposed');
  const progress = rows.filter(r => lane(r) === 'progress');
  return {
    rows,
    decisions: proposed.filter(r => isWaitingOnPerson(r) && str(r, 'state') !== 'Deferred').length,
    inProgress: progress.length,
    blocked: progress.filter(r => r.meta.state === 'Blocked').length,
    queued: proposed.length,
    tracked: mine.length > 0 || releasesFor(product, context.releases ?? []).length > 0,
  };
}

/** The ONE thing a card asks of a person, if anything. */
export type Attention = { line: string; tone: 'bad' | 'warn'; workTab: string | null };

/**
 * What needs a person, as one action. An issue first (a product in trouble
 * outranks a decision about its next feature), then decisions, then work
 * that has stopped. Nothing when nothing does: a quiet card is the good case.
 * @param health - The health reading.
 * @param work - What is underway.
 */
export function attentionOf(health: HealthReading, work: ProductWork): Attention | null {
  if (health.state === 'issue') {
    return {
      tone: 'bad',
      line: `Issue detected · ${work.inProgress > 0 ? `${plural(work.inProgress, 'change')} in progress` : 'nothing is being built for it'}`,
      workTab: null,
    };
  }
  if (work.decisions > 0) {
    return { tone: 'warn', line: `Review ${plural(work.decisions, 'decision')}`, workTab: groupTabKey('Proposed') };
  }
  if (work.blocked > 0) {
    return { tone: 'bad', line: `Unblock ${plural(work.blocked, 'change')}`, workTab: groupTabKey('In progress') };
  }
  return null;
}

/**
 * A release title that is only a version or a sha says nothing about what shipped.
 * @param title - The release's title.
 */
function isBareVersion(title: string): boolean {
  return /^(?:v?\d+(?:\.\d+)*(?:[-+.][\w.]+)?|[0-9a-f]{7,40})$/i.test(title.trim());
}

export type LatestRelease = { id: string | number | null; title: string; at: Date | null };

/**
 * The newest release worth naming: its title, not its version. A bare
 * version is skipped for the newest one that says what shipped; with no
 * release records loaded, the product's own `lastShipped` line stands in,
 * unlinked.
 * @param product - The product.
 * @param context - Requests and releases, when loaded.
 */
export function latestRelease(product: PageRow, context: ProductBoardContext): LatestRelease | null {
  const mine = context.releases ? releasesFor(product, context.releases) : [];
  const named = mine.find(r => r.title.trim() !== '' && !isBareVersion(r.title)) ?? mine[0];
  if (named) {
    return { id: named.id, title: named.title, at: date(named, 'releasedAt') ?? named.createdAt };
  }
  const shipped = str(product, 'lastShipped');
  return shipped ? { id: null, title: shipped, at: date(product, 'lastReleaseAt') } : null;
}

/**
 * What this product stands on, and what stands on it — read from the board's
 * own rows, so nothing is stored twice. "Built on Squatch Core" on an app;
 * "Send and Slate build on it" on the core. Nothing when neither is true.
 * @param row - The product.
 * @param all - Every product on the board.
 */
export function dependencyLine(row: PageRow, all: PageRow[]): string | null {
  const slug = str(row, 'slug');
  const nameOf = (s: string) => all.find(r => str(r, 'slug') === s)?.title ?? s;
  const on = list(row, 'dependsOn').map(nameOf);
  const dependents = slug ? all.filter(r => r !== row && list(r, 'dependsOn').includes(slug)).map(r => r.title) : [];
  const parts: string[] = [];
  if (on.length > 0) {
    parts.push(`Built on ${names(on)}`);
  }
  if (dependents.length > 0) {
    parts.push(`${names(dependents)} build${dependents.length === 1 ? 's' : ''} on it`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The card's lines for one product, as the `meta` keys the page declares.
 * Every key is absent (not empty) when the card should not draw it.
 * @param row - The product.
 * @param all - Every product on the board.
 * @param context - Requests and releases, when loaded.
 * @param now - The clock.
 */
export function productCard(row: PageRow, all: PageRow[], context: ProductBoardContext, now: Date): Record<string, unknown> {
  const latest = latestRelease(row, context);
  const health = healthReading(row, now, latest?.at ?? date(row, 'lastReleaseAt'));
  const work = productWork(row, context, now);
  const attention = attentionOf(health, work);
  // A product the factory has never built for says so, instead of reading
  // "Quiet: nothing open, nothing waiting on you" — which claims a calm the
  // board has no evidence of.
  const workNone = !work.tracked ? 'No work tracked here' : work.inProgress === 0 && work.queued === 0 ? 'No open work' : undefined;
  return {
    lifecycle: lifecycleLabel(row) ?? undefined,
    healthState: health.state,
    healthLabel: health.label,
    healthTone: health.tone,
    attentionLine: attention?.line,
    attentionTone: attention?.tone,
    attentionTab: attention?.workTab ?? undefined,
    inProgressLine: work.inProgress > 0 ? `${plural(work.inProgress, 'change')} in progress` : undefined,
    backlogLine: work.queued > 0 ? plural(work.queued, 'open request') : undefined,
    workNoneLine: workNone,
    latestReleaseLine: latest ? `Latest: ${latest.title}` : undefined,
    latestReleaseId: latest?.id ?? undefined,
    latestReleaseAt: latest?.at?.toISOString() ?? undefined,
    dependencyLine: dependencyLine(row, all) ?? undefined,
  };
}

/**
 * The Products page's rows with the card's lines on them.
 * @param rows - Product records.
 * @param options - The clock, and the requests and releases when loaded.
 * @param options.now - The clock.
 * @param options.requests - Every request record.
 * @param options.releases - Every release record.
 */
export function deriveProductBoard(rows: PageRow[], options: { now?: Date } & ProductBoardContext = {}): PageRow[] {
  const now = options.now ?? new Date();
  const context: ProductBoardContext = { requests: options.requests, releases: options.releases };
  return rows.map(row => ({ ...row, meta: { ...row.meta, ...productCard(row, rows, context, now) } }));
}
