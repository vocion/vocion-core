/**
 * Measures — the shapes the team report reads and derives from.
 *
 * A team declares MEASURES (`teams/<slug>.yaml` `measures:`); Vocion reads
 * each one from where its `source` says the truth lives and DERIVES
 * attainment, trend and the rest at report time. Nothing derived is ever
 * stored (manifesto #2). Pure: no database import, so every derivation
 * unit-tests in node. Spec: docs/specs/team-report-v2.md §1–§3.
 */

import type { MeasureWindow, ProvenanceKind } from '@/libs/workspace/schemas';
import type { TeamMeasure } from '@/models/Schema';

export type { MeasureDimension, MeasureWindow, ProvenanceKind } from '@/libs/workspace/schemas';
export type { TeamMeasure, TeamMeasureSource } from '@/models/Schema';

/** A half-open time range `[since, until)`. */
export type Range = { since: Date; until: Date };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * How long a measure window is. A quarter is 91 days — the longest window a
 * measure can be judged in; there is deliberately no "all time".
 * @param window - Measure window.
 */
export function windowMs(window: MeasureWindow): number {
  switch (window) {
    case '24h': return DAY;
    case '7d': return 7 * DAY;
    case '30d': return 30 * DAY;
    case 'quarter': return 91 * DAY;
  }
}

/**
 * The range a measure reads right now.
 * @param window - Measure window.
 * @param now - The clock, injectable for tests.
 */
export function measureRange(window: MeasureWindow, now: Date = new Date()): Range {
  return { since: new Date(now.getTime() - windowMs(window)), until: now };
}

/**
 * The range immediately before {@link measureRange} — what the trend arrow
 * compares against.
 * @param window - Measure window.
 * @param now - The clock.
 */
export function priorRange(window: MeasureWindow, now: Date = new Date()): Range {
  const ms = windowMs(window);
  const until = new Date(now.getTime() - ms);
  return { since: new Date(until.getTime() - ms), until };
}

/**
 * How current the system behind a reading is. For a verified reading this is
 * the CRM mirror's own freshness; for everything Vocion records itself the
 * reading is live and `asOf` is the report time.
 */
export type Freshness = {
  asOf: Date | null;
  ageMs: number | null;
  stale: boolean;
  /** One sentence a surface can quote when the reading is not current. */
  note: string | null;
};

export type TrendDirection = 'up' | 'down' | 'flat';

/**
 * Why a reading has no value. Every one of these renders as a STATE, never as
 * a zero — "a zero that means we did not ask" is the dishonesty the whole
 * provenance model exists to prevent (spec §2).
 *
 * `unconfigured`  nothing is connected: no credential for the connector, no
 *                 synced source. Nobody has asked the system of record
 *                 anything yet. The report says "not connected".
 * `error`         the read was attempted against a configured source and
 *                 failed — a refused credential, an HTTP error, a vault that
 *                 will not open. Transient or not, it is not a number.
 * `unsupported`   the source is connected and the read ran, but it cannot
 *                 answer what the measure asked: a filter naming values the
 *                 system does not have, an aggregate the mirror cannot
 *                 compute, a source arm with nothing named.
 */
export const MEASURE_UNAVAILABLE_KINDS = ['unconfigured', 'error', 'unsupported'] as const;
export type MeasureUnavailableKind = typeof MEASURE_UNAVAILABLE_KINDS[number];

/** The short words the chip appends, per unavailable kind. */
export const UNAVAILABLE_LABEL: Record<MeasureUnavailableKind, string> = {
  unconfigured: 'not connected',
  error: 'read failed',
  unsupported: 'cannot be read',
};

/** One measure, read. Everything past `measure` is derived. */
export type MeasureReading = {
  measure: TeamMeasure;
  /** The reading in the measure's own window; null when the source could not be read. */
  value: number | null;
  /** The same reading over the window before; null when unavailable. */
  previous: number | null;
  provenance: ProvenanceKind;
  /** The system that produced the number — "HubSpot", "review decisions", "worker reports". */
  sourceLabel: string;
  asOf: Date | null;
  freshness: Freshness;
  /** 0..1, capped, direction-aware, measured from the baseline when one is set. Null with no value. */
  attainment: number | null;
  /** The uncapped truth: is the target met in this window? */
  met: boolean;
  /** value − previous; null when either is missing. */
  delta: number | null;
  trend: TrendDirection | null;
  /** Whether the delta moved in the direction the measure calls better. */
  improving: boolean | null;
  /** Why `value` is null, for a person. */
  unavailableReason: string | null;
  /**
   * WHICH no-value state this is, for a surface to render differently from a
   * number. Null exactly when `value` is not null — the two always agree, so
   * no caller has to decide whether a missing value counts as zero.
   */
  unavailableKind: MeasureUnavailableKind | null;
};

/** The chip text, per provenance kind. */
export const PROVENANCE_LABEL: Record<ProvenanceKind, string> = {
  'verified': 'Verified',
  'observed': 'Observed',
  'human-confirmed': 'Human-confirmed',
  'agent-reported': 'Agent-reported',
};

/** What the chip's tooltip says the kind means. */
export const PROVENANCE_MEANING: Record<ProvenanceKind, string> = {
  'verified': 'Read from a system of record through a connector.',
  'observed': 'Vocion saw the action execute.',
  'human-confirmed': 'A person approved it.',
  'agent-reported': 'The worker reported this; not independently verified.',
};

/**
 * Strongest first — `verified` is 0.
 * @param kind - The provenance kind.
 */
export function provenanceRank(kind: ProvenanceKind): number {
  return ['verified', 'observed', 'human-confirmed', 'agent-reported'].indexOf(kind);
}

/**
 * The window label a person reads: "this week", "today", "last 30 days",
 * "this quarter".
 * @param window - Measure window.
 */
export function windowPhrase(window: MeasureWindow): string {
  switch (window) {
    case '24h': return 'today';
    case '7d': return 'this week';
    case '30d': return 'last 30 days';
    case 'quarter': return 'this quarter';
  }
}
