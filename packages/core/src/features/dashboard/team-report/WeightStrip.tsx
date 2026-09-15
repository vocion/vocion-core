import type { Swatch } from './palette';
import { Link } from '@/libs/I18nNavigation';
import { pct } from './format';
import { OTHER } from './palette';

export type WeightSegment = {
  key: string;
  label: string;
  value: number;
  swatch: Swatch;
  href?: string;
};

/**
 * One proportional bar — the share of a total, entity by entity — with a
 * text legend beneath it. Not a pie: a single bar reads left-to-right and
 * lines segments up against each other, which is the comparison the page
 * exists to make.
 *
 * Marks per the dataviz spec: a thin bar (12px), 2px surface gaps between
 * segments (the gap separates, never a stroke), rounded only at the two
 * data-ends. Segments under 1.5% fold into "Other" so slivers never fight
 * for a label; the legend names every visible segment with its share, so
 * identity is never color-alone.
 * @param props
 * @param props.segments - The parts; order is kept as given.
 * @param props.total - The whole; segments not summing to it leave the remainder blank.
 * @param props.ariaLabel - What the bar shows, for assistive tech.
 * @param props.maxSegments - Cap before folding into Other (default 8).
 */
export function WeightStrip({ segments, total, ariaLabel, maxSegments = 8 }: {
  segments: WeightSegment[];
  total: number;
  ariaLabel: string;
  maxSegments?: number;
}) {
  if (total <= 0) {
    return (
      <div className="h-3 w-full rounded-sm bg-muted" aria-label={ariaLabel} role="img" />
    );
  }
  const live = segments.filter(s => s.value > 0);
  const shown = live.filter((s, i) => i < maxSegments && s.value / total >= 0.015);
  const folded = live.filter(s => !shown.includes(s));
  const foldedValue = folded.reduce((a, s) => a + s.value, 0);
  const parts: WeightSegment[] = foldedValue > 0
    ? [...shown, { key: '__other', label: folded.length === 1 ? folded[0]!.label : `Other (${folded.length})`, value: foldedValue, swatch: OTHER }]
    : shown;

  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-sm" role="img" aria-label={ariaLabel}>
        {parts.map(p => (
          <span
            key={p.key}
            title={`${p.label} · ${pct(p.value / total)}`}
            className="h-full bg-(--seg) dark:bg-(--seg-dark)"
            style={{ 'width': `${(p.value / total) * 100}%`, '--seg': p.swatch.light, '--seg-dark': p.swatch.dark } as React.CSSProperties}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p) => {
          const body = (
            <>
              <span className="inline-block size-2 shrink-0 rounded-full bg-(--seg) dark:bg-(--seg-dark)" style={{ '--seg': p.swatch.light, '--seg-dark': p.swatch.dark } as React.CSSProperties} aria-hidden />
              <span className="text-foreground/80">{p.label}</span>
              <span className="text-muted-foreground tabular-nums">{pct(p.value / total)}</span>
            </>
          );
          return (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              {p.href
                ? <Link href={p.href} className="inline-flex items-center gap-1.5 hover:underline">{body}</Link>
                : body}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
