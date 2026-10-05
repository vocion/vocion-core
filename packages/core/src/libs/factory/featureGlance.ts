/**
 * A FEATURE AT A GLANCE — how long it took, how many attempts, what it cost —
 * as the public page's three figures and as the line a pasted link unfurls
 * with (Chris, 2026-10-03: "the og:description … should lead with the build
 * time and the cost, since those are the headline numbers"). One reading of
 * the figures, so the chips on the page and the line in a chat app can never
 * disagree.
 *
 * Pure and client-safe.
 */

/** Who built it when the workspace's own name cannot be read: the one product label allowed as a default. */
export const DEFAULT_BUILDER = 'Vocion Software Factory';
/** The site a link unfurls under when the workspace's own name cannot be read. */
export const DEFAULT_SITE_NAME = 'Vocion';
/** The longest the unfurl's description runs. */
export const DESCRIPTION_MAX = 200;
/** The longest the unfurl's title runs with its figures; past it, the name alone. */
export const CARD_TITLE_MAX = 70;

/** The figures, as the page carries them. */
export type GlanceEffort = {
  /** "1h 12m" (`compactSpan`), or null when nothing is dated. */
  duration: string | null;
  /** What the duration runs from: the ask, or the go-ahead a person gave a proposal. Absent reads as the ask. */
  from?: 'ask' | 'go-ahead';
  until: 'seen live' | 'shipped' | 'so far' | null;
  attempts: number | null;
  /** "$4.80", or null when nothing is costed. */
  total: string | null;
};

/**
 * A span the compact way: "38m", "1h 12m", "1h", "2d 3h". Under a minute is
 * "<1m" — never "0m".
 * @param ms - The span.
 */
export function compactSpan(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) {
    return null;
  }
  const min = Math.floor(ms / 60_000);
  if (min < 1) {
    return '<1m';
  }
  if (min < 60) {
    return `${min}m`;
  }
  const h = Math.floor(min / 60);
  if (h < 24) {
    return min % 60 === 0 ? `${h}h` : `${h}h ${min % 60}m`;
  }
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

/** The stretches the time went to, in the order they happen. */
export const PHASES = ['plan', 'build', 'qa', 'release', 'live'] as const;
export type Phase = typeof PHASES[number];
const PHASE_LABEL: Record<Phase, string> = { plan: 'Plan', build: 'Build', qa: 'QA', release: 'Release', live: 'Live check' };

/**
 * WHERE THE TIME WENT (Chris, 2026-10-03: "the duration split, e.g. building
 * vs QA vs deploy"). Each stretch between two steps is counted to the phase
 * of the step that ends it — the wait before "Built" was building, the wait
 * before "QA approved" was QA — so the parts add up to the time from the ask
 * to the last step. A phase with no time is left out.
 * @param steps - The timeline, oldest first, each step with its phase (null for the ask).
 */
export function timeSplit(steps: ReadonlyArray<{ at: string; phase: Phase | null }>): Array<{ label: string; amount: string }> {
  const ms = new Map<Phase, number>();
  for (let i = 1; i < steps.length; i++) {
    const phase = steps[i]!.phase;
    const span = Date.parse(steps[i]!.at) - Date.parse(steps[i - 1]!.at);
    if (phase && Number.isFinite(span) && span > 0) {
      ms.set(phase, (ms.get(phase) ?? 0) + span);
    }
  }
  return PHASES
    .filter(p => (ms.get(p) ?? 0) > 0)
    .map(p => ({ label: PHASE_LABEL[p], amount: compactSpan(ms.get(p)!)! }));
}

/** What the duration runs to, as the figure's label. */
const UNTIL: Record<NonNullable<GlanceEffort['until']>, string> = {
  'seen live': 'to seen live',
  'shipped': 'to shipped',
  'so far': 'so far',
};

/**
 * The duration's label: where it runs from and to. A proposal a person
 * approved runs from the go-ahead, so the days it waited are not "built in".
 * @param effort - The page's effort.
 */
export function durationLabel(effort: Pick<GlanceEffort, 'from' | 'until'>): string {
  if (!effort.until) {
    return '';
  }
  return effort.until === 'so far' ? 'so far' : `${effort.from === 'go-ahead' ? 'go-ahead' : 'ask'} ${UNTIL[effort.until]}`;
}

/** One figure: its value large, its label small. */
export type GlanceStat = { key: 'duration' | 'attempts' | 'cost'; value: string; label: string };

/**
 * The figures the page has, in order: how long, how many attempts, the
 * total. A figure that is missing is left out — never "0m", never "$0.00".
 * @param effort - The page's effort.
 */
export function glanceStats(effort: GlanceEffort): GlanceStat[] {
  const out: GlanceStat[] = [];
  if (effort.duration && effort.until) {
    out.push({ key: 'duration', value: effort.duration, label: durationLabel(effort) });
  }
  if (effort.attempts !== null && effort.attempts > 0) {
    out.push({ key: 'attempts', value: String(effort.attempts), label: effort.attempts === 1 ? 'attempt' : 'attempts' });
  }
  if (effort.total && effort.total !== '$0.00') {
    out.push({ key: 'cost', value: effort.total, label: 'total cost' });
  }
  return out;
}

/** The two headline numbers — how long and what it cost — and whether it is still being built. */
export type Headline = { took: string | null; cost: string | null; soFar: boolean };

/**
 * The headline numbers, read off the same figures the page shows, or null
 * when it has neither.
 * @param effort - The page's effort.
 */
export function headlineOf(effort: GlanceEffort): Headline | null {
  const stats = glanceStats(effort);
  const took = stats.find(s => s.key === 'duration')?.value ?? null;
  const cost = stats.find(s => s.key === 'cost')?.value ?? null;
  return took || cost ? { took, cost, soFar: effort.until === 'so far' } : null;
}

/**
 * The headline as words, with or without who built it and for which product:
 * "Built in 1h 12m for $4.80", "Built by Northwind for Ledger in 1h 12m for
 * $4.80"; still in progress, "Being built · 3h so far · $1.20". Empty when
 * there is no number and no one to say it of.
 * @param effort - The page's effort.
 * @param builtBy - The workspace's own name, to attribute it; left out on the page, where its top bar says it.
 * @param product - The product's own name, when the work names one.
 */
export function builtLine(effort: GlanceEffort, builtBy?: string, product?: string | null): string {
  const h = headlineOf(effort);
  const by = `${builtBy ? ` by ${builtBy}` : ''}${builtBy && product ? ` for ${product}` : ''}`;
  if (!h) {
    return by ? `Built${by}` : '';
  }
  if (h.soFar) {
    return [`Being built${by}`, h.took ? `${h.took} so far` : null, h.cost].filter(Boolean).join(' · ');
  }
  return `Built${by}${h.took ? ` in ${h.took}` : ''}${h.cost ? ` for ${h.cost}` : ''}`;
}

/**
 * Text cut to a length at a word, marked with an ellipsis when cut. Only for
 * a preview line with a hard limit; the page itself shows the whole sentence.
 * @param text - The text.
 * @param max - The limit.
 */
function fit(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max - 1);
  const word = cut.lastIndexOf(' ');
  return `${(word > max / 2 ? cut.slice(0, word) : cut).trimEnd()}…`;
}

/**
 * The unfurl's description: who built it, how long and the cost first, then
 * what it built — "Built by Northwind in 1h 12m for $4.80 · Library rows show
 * when each file was uploaded." Under {@link DESCRIPTION_MAX} characters.
 * @param effort - The page's effort.
 * @param builtBy - The workspace's own name.
 * @param built - What it built, one sentence.
 * @param product - The product's own name, when the work names one.
 */
export function cardDescription(effort: GlanceEffort, builtBy: string, built: string, product?: string | null): string {
  return fit([builtLine(effort, builtBy, product), built.trim()].filter(Boolean).join(' · '), DESCRIPTION_MAX);
}

/**
 * The unfurl's title: the name, with how long and the cost when it all fits
 * under {@link CARD_TITLE_MAX} characters — "Sort the library by name or date
 * · 1h 12m · $4.80" — else the name alone.
 * @param name - The feature's name.
 * @param effort - The page's effort.
 */
export function cardTitle(name: string, effort: GlanceEffort): string {
  const h = headlineOf(effort);
  const figures = h && !h.soFar ? [h.took, h.cost].filter((v): v is string => v !== null) : [];
  const withFigures = [name, ...figures].join(' · ');
  return withFigures.length <= CARD_TITLE_MAX ? withFigures : fit(name, CARD_TITLE_MAX);
}
