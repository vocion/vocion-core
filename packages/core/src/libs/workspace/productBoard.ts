import type { PageRow } from './pageFields';

/**
 * ONE SENTENCE PER PRODUCT: what a person should do about it, or that it is
 * too early to say. Stage, health, last release and open work describe a
 * product; they do not answer "how is it doing?" (review, 2026-09-24:
 * "Products is missing the executive recommendation"). This derives that
 * sentence from the record's own rollups — counted from the request and
 * release records on every write, never an agent's morning refresh — and
 * from the health the monitor last reported.
 *
 * The order is the order a person should care: something is down, then
 * something is waiting on them, then something is being built, then a
 * release too young to judge, then quiet. Each line says the figure it rests
 * on so it can be checked in one move (principle 10).
 */

/** How long a release is "too early to judge". A week is the usual `checkAfter` for a bet. */
export const YOUNG_RELEASE_DAYS = 7;

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

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * The line, and the tone a page may paint it with.
 * @param row - The product row.
 * @param now - The clock.
 */
export function boardLine(row: PageRow, now: Date): { line: string; tone: 'bad' | 'warn' | 'info' | 'muted' | 'ok' } {
  const health = str(row, 'health');
  const open = num(row, 'openRequests');
  const deciding = num(row, 'awaitingDecision');
  const building = num(row, 'inFlight');
  const lastRelease = date(row, 'lastReleaseAt');
  const stage = str(row, 'stage');

  if (health === 'down' || health === 'degraded') {
    const since = date(row, 'healthCheckedAt');
    return {
      tone: 'bad',
      line: `Needs attention: ${health === 'down' ? 'down' : 'degraded'} as of the last check${since ? ` (${since.toISOString().slice(0, 10)})` : ''}${building > 0 ? `; ${plural(building, 'fix')} in flight` : '; nothing is being built for it'}.`,
    };
  }
  if (deciding > 0) {
    return { tone: 'warn', line: `Waiting on you: ${plural(deciding, 'decision')} to make${building > 0 ? `; ${plural(building, 'change')} building` : ''}.` };
  }
  if (building > 0) {
    return { tone: 'info', line: `Building: ${plural(building, 'change')} in flight, ${plural(open, 'open request')} in all. No action needed from you.` };
  }
  if (lastRelease && now.getTime() - lastRelease.getTime() < YOUNG_RELEASE_DAYS * 86_400_000) {
    return { tone: 'muted', line: `Too early to judge: released ${lastRelease.toISOString().slice(0, 10)}; result checks are still due.` };
  }
  if (stage === 'idea' || stage === 'building') {
    return { tone: 'muted', line: `Not live yet: ${stage === 'idea' ? 'an idea with nothing built' : 'being built'}${open > 0 ? `, ${plural(open, 'open request')}` : ''}.` };
  }
  if (open > 0) {
    return { tone: 'muted', line: `Steady: ${plural(open, 'open request')}, none urgent, nothing waiting on you.` };
  }
  return { tone: 'ok', line: 'Quiet: nothing open, nothing waiting on you.' };
}

/**
 * The Products page's rows with the line on them.
 * @param rows - Product records.
 * @param options - The clock.
 * @param options.now
 * @param row
 * @param key
 */
function list(row: PageRow, key: string): string[] {
  const v = (row.meta ?? {})[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : [];
}

function names(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
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

export function deriveProductBoard(rows: PageRow[], options: { now?: Date } = {}): PageRow[] {
  const now = options.now ?? new Date();
  return rows.map((row) => {
    const { line, tone } = boardLine(row, now);
    return { ...row, meta: { ...row.meta, boardLine: line, boardTone: tone, dependencyLine: dependencyLine(row, rows) ?? undefined } };
  });
}
