/**
 * HANDOFF GATES — declared on an object type, run where the record changes.
 *
 * Chris, 2026-09-24: "the factory needs to know what good work looks like,
 * check the evidence, and send weak work back to the seat that produced it."
 * A gate is the deterministic half of that: a type declares, per transition,
 * what must be on the record before it may move (`gates:` in type.yaml,
 * stored as `schema['x-gates']`). A write that would cross the transition
 * without it is REFUSED, the record is marked returned to the seat that
 * produced it, and the refusal names each missing thing — so the seat fixes
 * the work, and no person is interrupted. The judge half (the seat's rubric,
 * the reference cases, escalation to a person) comes after this and only
 * runs when this passes.
 *
 * Core ships the grammar and the check; the plugin declares the gates; the
 * workspace steers the numbers. Nothing here knows what a request is.
 */

export type GateRequirement = {
  field: string;
  /** The field must be present and not empty. */
  present?: boolean;
  /** An array field must have at least this many items. */
  minItems?: number;
  /** A string field must be one of these. */
  oneOf?: string[];
  /** A date-time field must be within this many days of now. */
  maxAgeDays?: number;
  /** What to say when it fails — in the seat's terms; defaults to a plain sentence. */
  message?: string;
};

export type HandoffGate = {
  name: string;
  /** The transition: `field` taking one of `becomes`. */
  when: { field: string; becomes: string[] };
  /** The seat whose work this is — where a failure is returned to. */
  producedBy: string;
  require: GateRequirement[];
  /** The judgement half — see `services/gates/handoffJudge.ts`. */
  judge?: {
    rubric: string;
    cases?: string;
    escalateBelow: number;
    sampleRate: number;
    alwaysEscalate?: Record<string, string[]>;
  };
};

export type GateFailure = { gate: HandoffGate; failed: Array<{ field: string; why: string }>; to: string };

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) {
    return true;
  }
  if (typeof v === 'string') {
    return v.trim() === '';
  }
  if (Array.isArray(v)) {
    return v.length === 0;
  }
  if (typeof v === 'object') {
    return Object.keys(v as object).length === 0;
  }
  return false;
}

function get(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), record);
}

/**
 * The gates a stored type schema declares (`schema['x-gates']`), or none.
 * @param schema
 */
export function gatesOf(schema: Record<string, unknown> | null | undefined): HandoffGate[] {
  const raw = schema?.['x-gates'];
  return Array.isArray(raw) ? (raw as HandoffGate[]).filter(g => g && typeof g.name === 'string' && g.when && Array.isArray(g.require)) : [];
}

/**
 * Check one requirement against the record as it would be after the write.
 * @param merged - Current metadata with the write applied.
 * @param r - The requirement.
 * @param now - The clock.
 * @returns Why it fails, or null when it holds.
 */
export function requirementFailure(merged: Record<string, unknown>, r: GateRequirement, now: Date = new Date()): string | null {
  const v = get(merged, r.field);
  if ((r.present || r.minItems !== undefined || r.oneOf || r.maxAgeDays !== undefined) && isEmpty(v)) {
    return r.message ?? `${r.field} is not on the record`;
  }
  if (r.minItems !== undefined) {
    const n = Array.isArray(v) ? v.length : 0;
    if (n < r.minItems) {
      return r.message ?? `${r.field} has ${n} item${n === 1 ? '' : 's'}; at least ${r.minItems} needed`;
    }
  }
  if (r.oneOf && !(typeof v === 'string' && r.oneOf.includes(v))) {
    return r.message ?? `${r.field} is "${String(v)}", not one of ${r.oneOf.join(', ')}`;
  }
  if (r.maxAgeDays !== undefined) {
    const at = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null;
    if (!at || Number.isNaN(at.getTime())) {
      return r.message ?? `${r.field} is not a date`;
    }
    const days = (now.getTime() - at.getTime()) / 86_400_000;
    if (days > r.maxAgeDays) {
      return r.message ?? `${r.field} is ${Math.floor(days)} days old; it has to be within ${r.maxAgeDays}`;
    }
  }
  return null;
}

/**
 * Which gate, if any, this write fails.
 * @param gates - The type's gates.
 * @param current - The record's metadata before the write.
 * @param set - The write.
 * @param now - The clock.
 */
export function evaluateGates(gates: HandoffGate[], current: Record<string, unknown>, set: Record<string, unknown>, now: Date = new Date()): GateFailure | null {
  const merged = { ...current, ...set };
  for (const gate of gates) {
    const to = set[gate.when.field];
    if (typeof to !== 'string' || !gate.when.becomes.includes(to)) {
      continue;
    }
    if (current[gate.when.field] === to) {
      continue; // not a transition
    }
    const failed = gate.require
      .map(r => ({ field: r.field, why: requirementFailure(merged, r, now) }))
      .filter((f): f is { field: string; why: string } => f.why !== null);
    if (failed.length > 0) {
      return { gate, failed, to };
    }
  }
  return null;
}

/**
 * The seat's short name, for a badge: `product-manager` → PM.
 * @param slug
 */
export function seatLabel(slug: string): string {
  const s = slug.toLowerCase();
  if (s.includes('product') || s === 'pm') {
    return 'PM';
  }
  if (s.includes('design')) {
    return 'Design';
  }
  if (s.includes('engineer') || s === 'eng') {
    return 'Eng';
  }
  if (s.includes('review') || s === 'qa') {
    return 'QA';
  }
  return slug;
}

/**
 * The refusal, in one message the seat can act on.
 * @param f - The failure.
 * @param label - The type's label.
 */
export function gateRefusal(f: GateFailure, label: string): string {
  const list = f.failed.map(x => `${x.field}: ${x.why}`).join('; ');
  return `Not moved to ${f.to}: the ${label.toLowerCase()} fails the "${f.gate.name}" gate — ${list}. Returned to ${seatLabel(f.gate.producedBy)}; fix the record, then move it again. A gate is not argued with in prose.`;
}
