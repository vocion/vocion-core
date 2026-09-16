import type { ComponentProps } from 'react';
import type { ConfidenceLevel } from '@/types/Status';
import { cn } from '@/utils/Helpers';

/**
 * ConfidenceBars — **the** way a confidence is drawn anywhere in Vocion.
 *
 * Before this there were three: a dot-and-word pill (`ConfidenceIndicator`),
 * `speculative 0.42` as plain text on Personalization, and a bare `85%` in the
 * inbox. Three renderings of one idea is the defect MANIFESTO §19 names — so
 * this is one component, extended rather than forked, and the other three call
 * it.
 *
 * Chris, 2026-09-16: *"a little visual indicator — signal bars or a
 * color-coded fill bar, small"*.
 *
 * Five small bars encode the magnitude; the colour encodes the level
 * (`confident` ≥ 0.8 green, `uncertain` ≥ 0.55 amber, `speculative` below);
 * the number is always written out beside them, and so is **the class the
 * number is about**.
 *
 * ## Never a bare score
 *
 * `subject` names what the confidence is IN — "Not discovery", "Proposal-ready",
 * "Enroll MQL in sequence". A reader seeing `95%` under the word "discovery"
 * on a record that says "not a discovery call" is the bug this whole change
 * exists to fix (`docs/specs/discovery-ledger-v2.md`), so the subject travels
 * with the number into the visible text, the tooltip and the accessible name.
 * With no subject the level word plays that role — `speculative 42%` — which
 * is still a class, not a bare score.
 *
 * ## A level with no score
 *
 * Some paths record only a level (a chat answer's self-assessment). Passing
 * `level` without `value` fills the bars to that band and writes the level
 * word — no percentage is shown and none is invented; the accessible name says
 * "no score recorded".
 */

type Spec = { fill: string; track: string; fg: string; label: string };

const SPEC: Record<ConfidenceLevel, Spec> = {
  confident: {
    fill: 'bg-[var(--brand-pass)]',
    track: 'bg-[var(--brand-pass)]/20',
    fg: 'text-[var(--brand-pass)]',
    label: 'confident',
  },
  uncertain: {
    fill: 'bg-[var(--brand-borderline)]',
    track: 'bg-[var(--brand-borderline)]/20',
    fg: 'text-[var(--brand-borderline)]',
    label: 'uncertain',
  },
  speculative: {
    fill: 'bg-muted-foreground/70',
    track: 'bg-muted-foreground/20',
    fg: 'text-muted-foreground',
    label: 'speculative',
  },
};

const BARS = 5;

/** Where a level sits when there is no number — the band's own height, not a guess at a score. */
const BAND_BARS: Record<ConfidenceLevel, number> = { confident: 5, uncertain: 3, speculative: 1 };

/**
 * The one confidence ladder. `lead_brief.confidence`, a classifier's
 * `classificationConfidence` and a proposal's `proposal.confidence` are all
 * raw 0..1 scores; moving these cut points re-labels every surface at once,
 * with no backfill anywhere.
 * @param score - Raw 0..1 confidence, or null when unscored.
 */
export function confidenceLevel(score: number | null | undefined): ConfidenceLevel | null {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return null;
  }
  if (score >= 0.8) {
    return 'confident';
  }
  if (score >= 0.55) {
    return 'uncertain';
  }
  return 'speculative';
}

/**
 * `0.95` → `95%`; `score` format keeps the two decimals for a debugging surface.
 * @param value
 * @param format
 */
export function confidenceReading(value: number, format: 'percent' | 'score'): string {
  const v = Math.min(1, Math.max(0, value));
  return format === 'score' ? v.toFixed(2) : `${Math.round(v * 100)}%`;
}

export type ConfidenceBarsProps = Omit<ComponentProps<'span'>, 'title'> & {
  /** The raw confidence, 0..1. Null renders nothing unless a `level` is given. */
  value?: number | null;
  /** Used when there is no number, or to override the ladder. */
  level?: ConfidenceLevel | null;
  /** What the confidence is IN — the class, the verdict, the recommendation. */
  subject?: string;
  format?: 'percent' | 'score';
  size?: 'sm' | 'md';
  /** Extra sentence appended to the tooltip — the model's rationale, a threshold. */
  note?: string | null;
  /** Hide the written reading (a dense column that labels itself elsewhere). Never hides it from the accessible name. */
  readingHidden?: boolean;
  /**
   * Write this instead of the percentage — a coverage STATE ("Partial"), where
   * the raw number is not a calibrated probability and printing it would claim
   * a precision nothing earns. The value still drives the bars and the level,
   * so the picture and the word cannot disagree.
   */
  reading?: string;
};

/**
 * @param props - See {@link ConfidenceBarsProps}.
 * @param props.value
 * @param props.level
 * @param props.subject
 * @param props.format
 * @param props.size
 * @param props.note
 * @param props.readingHidden
 * @param props.reading
 * @param props.className
 */
export function ConfidenceBars({
  value,
  level: levelProp,
  subject,
  format = 'percent',
  size = 'sm',
  note,
  readingHidden,
  reading: readingOverride,
  className,
  ...rest
}: ConfidenceBarsProps) {
  const scored = typeof value === 'number' && Number.isFinite(value);
  const level = levelProp ?? confidenceLevel(scored ? value! : null);
  if (!level) {
    return null;
  }
  const spec = SPEC[level];
  const filled = scored
    ? Math.min(BARS, Math.max(1, Math.ceil(Math.min(1, Math.max(0, value!)) * BARS)))
    : BAND_BARS[level];
  const reading = readingOverride ?? (scored ? confidenceReading(value!, format) : null);

  // The visible text: the class first, the number second. Never one without
  // the other.
  const visible = subject
    ? (reading ? `${subject} ${reading}` : subject)
    : (reading ? `${spec.label} ${reading}` : spec.label);

  const accessible = [
    subject ?? 'Confidence',
    '—',
    reading ? (readingOverride ? reading : `${reading} confidence`) : 'no score recorded',
    `(${spec.label})`,
  ].join(' ');

  const bar = size === 'md' ? 'h-3 w-[3px]' : 'h-2.5 w-[3px]';

  return (
    <span
      data-slot="confidence-bars"
      data-level={level}
      data-value={scored ? value : undefined}
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}
      title={note ? `${accessible} · ${note}` : accessible}
      {...rest}
    >
      <span className="inline-flex items-end gap-[2px]" role="img" aria-label={accessible}>
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            className={cn('inline-block rounded-[1px]', bar, i < filled ? spec.fill : spec.track)}
          />
        ))}
      </span>
      <span className={cn('text-[12px] font-medium tabular-nums', spec.fg, readingHidden && 'sr-only')}>
        {visible}
      </span>
    </span>
  );
}

type IndicatorProps = Omit<ConfidenceBarsProps, 'value' | 'level'> & {
  level: ConfidenceLevel | null | undefined;
};

/**
 * The level-only form, for the paths that record a self-assessment without a
 * score (a chat answer, a draft card). Same component, same bars, no invented
 * number. Renders nothing for a null level — most runtime paths still expose
 * no confidence signal and a "—" placeholder is noise.
 * @param props - See {@link ConfidenceBarsProps}; `level` is required.
 * @param props.level
 */
export function ConfidenceIndicator({ level, ...rest }: IndicatorProps) {
  return <ConfidenceBars level={level ?? null} {...rest} />;
}
