/**
 * Deltas, structurally (`docs/specs/briefing-v2.md` §5).
 *
 * > The page reports state when it should report change. "$3.52M open
 * > pipeline" is useful once. Tomorrow morning I mostly care whether it
 * > became $3.72M.
 *
 * So the previous value is a **typed join on `key` against the prior
 * briefing's stored metrics**, not a sentence the model remembered to write.
 * Two rules the tests hold:
 *
 *   - no prior value ⇒ no delta and no arrow. The first brief renders
 *     `Open pipeline $3.52M`, never `↑ $0`;
 *   - `changes` are only keys whose value or status actually differs — the
 *     list is computed first and narrated second.
 *
 * Pure. The clock, the database and the model are all somewhere else.
 */

import type { BriefingChange, BriefingMetric, MetricDirection } from './document';

/** How small a move still counts as flat — floating-point noise is not news. */
const EPSILON = 1e-9;

/**
 * Which way a move went.
 * @param delta - current − previous.
 */
export function directionOf(delta: number): MetricDirection {
  if (Math.abs(delta) < EPSILON) {
    return 'flat';
  }
  return delta > 0 ? 'up' : 'down';
}

/**
 * Join this brief's metrics to the prior brief's by `key` and fill in
 * `previous` / `delta` / `direction`.
 *
 * A key the prior brief did not carry, a prior value of `null` (the source
 * could not be read then), or a current value of `null` (it cannot be read
 * now) all produce a metric with **no** delta fields at all — the renderer
 * then shows the value alone. `previous` is never defaulted to 0.
 * @param current - This brief's metrics.
 * @param prior - The prior brief's metrics, or null on the first brief.
 */
export function joinDeltas(current: BriefingMetric[], prior: BriefingMetric[] | null): BriefingMetric[] {
  const before = new Map<string, number>();
  for (const m of prior ?? []) {
    if (m.value !== null && m.value !== undefined) {
      before.set(m.key, m.value);
    }
  }
  return current.map((m) => {
    // Strip any delta the caller (or the model) put there: this function is
    // the only writer, so a fabricated delta cannot survive the composer.
    const { previous: _p, delta: _d, direction: _dir, ...rest } = m;
    const previous = before.get(m.key);
    if (previous === undefined || m.value === null) {
      return { ...rest } as BriefingMetric;
    }
    const delta = m.value - previous;
    return { ...rest, previous, delta, direction: directionOf(delta) } as BriefingMetric;
  });
}

/**
 * The `changes` section, computed.
 *
 * One item per key whose value moved, plus one per key that appeared or
 * disappeared — appearing and disappearing are changes of status, and the
 * review asked for both ("whether something entered contract", "3 call
 * outcomes missing"). Nothing else is a change, whatever the narrative says.
 *
 * Narratives are attached afterwards by {@link narrateChanges}, keyed on the
 * same `key`, so the model can explain a change but can never invent one.
 * @param current - This brief's metrics (post-join).
 * @param prior - The prior brief's metrics, or null.
 */
export function computeChanges(current: BriefingMetric[], prior: BriefingMetric[] | null): BriefingChange[] {
  if (!prior) {
    return [];
  }
  const priorByKey = new Map(prior.map(m => [m.key, m]));
  const out: BriefingChange[] = [];

  for (const m of current) {
    const was = priorByKey.get(m.key);
    if (!was) {
      // A metric that was not being read before. Only news when it has a value.
      if (m.value !== null) {
        out.push({ key: m.key, label: m.label, from: null, to: m.value, unit: m.unit, provenance: m.provenance, evidence: m.evidence ?? [] });
      }
      continue;
    }
    if (was.value === null && m.value !== null) {
      out.push({ key: m.key, label: m.label, from: 'unavailable', to: m.value, unit: m.unit, provenance: m.provenance, evidence: m.evidence ?? [] });
      continue;
    }
    if (was.value !== null && m.value === null) {
      out.push({ key: m.key, label: m.label, from: was.value, to: 'unavailable', unit: m.unit, provenance: m.provenance, evidence: m.evidence ?? [] });
      continue;
    }
    if (was.value === null || m.value === null) {
      continue;
    }
    const delta = m.value - was.value;
    if (Math.abs(delta) < EPSILON) {
      continue;
    }
    out.push({ key: m.key, label: m.label, from: was.value, to: m.value, delta, direction: directionOf(delta), unit: m.unit, provenance: m.provenance, evidence: m.evidence ?? [] });
  }

  for (const was of prior) {
    if (!current.some(m => m.key === was.key) && was.value !== null) {
      out.push({ key: was.key, label: was.label, from: was.value, to: null, unit: was.unit, provenance: was.provenance, evidence: [] });
    }
  }

  return out;
}

/**
 * Attach the model's one-clause narration to computed changes. A narration
 * whose key names no computed change is dropped on the floor — that is the
 * whole point.
 * @param changes - Computed changes.
 * @param narratives - `key` → clause, as the model supplied them.
 */
export function narrateChanges(changes: BriefingChange[], narratives: Record<string, string>): BriefingChange[] {
  return changes.map((c) => {
    const narrative = narratives[c.key]?.trim();
    return narrative ? { ...c, narrative } : c;
  });
}

/**
 * Rank changes for the above-the-fold budget: biggest relative move first,
 * status changes ahead of numeric ones (something entering or leaving the
 * picture is more newsworthy than a number nudging), stable tie-break on key.
 * @param changes - Computed changes.
 */
export function rankChanges(changes: BriefingChange[]): BriefingChange[] {
  const score = (c: BriefingChange): number => {
    const statusChange = typeof c.from !== 'number' || typeof c.to !== 'number';
    if (statusChange) {
      return Number.POSITIVE_INFINITY;
    }
    const from = c.from as number;
    const to = c.to as number;
    const base = Math.abs(from) > EPSILON ? Math.abs((to - from) / from) : Math.abs(to);
    return base;
  };
  return [...changes].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    // Compared, not subtracted: two status changes both score Infinity and
    // `Infinity - Infinity` is NaN, which sorts nothing.
    if (sa !== sb) {
      return sa > sb ? -1 : 1;
    }
    return a.key.localeCompare(b.key);
  });
}
