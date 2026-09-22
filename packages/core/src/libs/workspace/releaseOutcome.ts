import type { PageRow } from './pageFields';

/**
 * What production said about a release, and the fact that nobody has asked.
 *
 * Shipping is not the end of the loop. `healthAfter` answers "did the deploy
 * work" minutes after the swap; this answers "did the CHANGE work", which is
 * a different question and a later one. A factory that never looks back
 * cannot tell a release that helped from one that quietly cost 15% of a
 * funnel — and the looking back is most of what separates a factory from an
 * autonomous coding tool.
 *
 * Nothing fills this yet: there is no analytics reader wired to production.
 * That is exactly why the ABSENCE is drawn rather than left blank. A release
 * old enough to have an answer and carrying none says so, which turns a
 * missing capability into visible work instead of a silence nobody notices.
 */

/** How long a release must be live before "nobody looked" is a fair thing to say. */
export const SOAK_HOURS = 24;

type Measure = { label?: string; before?: number; after?: number; unit?: string; goodWhen?: 'up' | 'down' };

function outcomeOf(row: PageRow): Record<string, unknown> {
  const raw = (row.meta ?? {}).outcome;
  return raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function releasedAt(row: PageRow): Date | null {
  const raw = (row.meta ?? {}).releasedAt;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return null;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Hours since a release went out, or null when it carries no date.
 * @param row
 * @param now
 */
export function hoursLive(row: PageRow, now: Date): number | null {
  const at = releasedAt(row);
  return at === null ? null : (now.getTime() - at.getTime()) / 3_600_000;
}

/**
 * The line a release row carries about its own outcome.
 *
 * Four states, and the third is the point:
 *   - a verdict, when somebody looked
 *   - "watching" while it is too young to judge
 *   - "outcome not checked" once it is old enough and nobody did
 *   - nothing at all when the release carries no date to measure from,
 *     because "not checked" would be a claim about a clock we do not have
 * @param row - The release row.
 * @param now - The clock.
 */
export function outcomeLine(row: PageRow, now: Date = new Date()): string | null {
  const o = outcomeOf(row);
  const verdict = typeof o.verdict === 'string' ? o.verdict : null;
  if (verdict !== null) {
    return verdict;
  }
  const live = hoursLive(row, now);
  if (live === null) {
    return null;
  }
  return live < SOAK_HOURS ? 'watching' : 'outcome not checked';
}

/**
 * A measure stated against what it was before.
 *
 * A number on its own is uninterpretable: "share completion 76%" says
 * nothing, "91% → 76%" says the release broke something. A measure with no
 * `before` is reported as unreadable rather than quietly shown as flat.
 * @param m - The measure.
 */
export function measureLine(m: Measure): string {
  const unit = m.unit ?? '';
  const label = m.label ?? 'measure';
  if (typeof m.after !== 'number') {
    return `${label} not read`;
  }
  if (typeof m.before !== 'number') {
    return `${label} ${m.after}${unit} — nothing to compare against`;
  }
  if (m.before === m.after) {
    return `${label} unchanged at ${m.after}${unit}`;
  }
  const up = m.after > m.before;
  const arrow = up ? '↑' : '↓';
  const judged = m.goodWhen === undefined ? '' : (up ? m.goodWhen === 'up' : m.goodWhen === 'down') ? '' : ' — worse';
  return `${label} ${m.before}${unit} → ${m.after}${unit} ${arrow}${judged}`;
}

/**
 * Every measure on a release, as the lines a row would print.
 * @param row
 */
export function measureLines(row: PageRow): string[] {
  const raw = outcomeOf(row).measures;
  return (Array.isArray(raw) ? raw : []).map(m => measureLine((m ?? {}) as Measure));
}

/**
 * Every release row, carrying what production said about it.
 *
 * Pure, so the reading can be argued with in a test rather than in a browser
 * — the same shape as `deriveWorkQueue`, and the second member of what the
 * schema always said would be a closed set rather than an expression
 * language on a page.
 * @param rows - The release rows.
 * @param options - Clock, for tests.
 * @param options.now - The clock.
 */
export function deriveReleaseOutcome(rows: PageRow[], options: { now?: Date } = {}): PageRow[] {
  const now = options.now ?? new Date();
  return rows.map((row) => {
    const line = outcomeLine(row, now);
    const measures = measureLines(row);
    return {
      ...row,
      meta: {
        ...row.meta,
        outcomeLine: line ?? undefined,
        // Joined here rather than in the page: a row draws one muted line,
        // and a list of three facts is still one line.
        outcomeMeasures: measures.length > 0 ? measures.join(' · ') : undefined,
      },
    };
  });
}
