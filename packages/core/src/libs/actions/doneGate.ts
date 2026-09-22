/**
 * THE GATE BETWEEN "THE CHECKS PASSED" AND "IT IS DONE".
 *
 * On 2026-09-22 the factory renamed a product, merged the pull request, passed
 * typecheck, tests and its own style check, and marked the work accepted. The
 * site still said **Send**, with the old icon. Not one of those checks asks the
 * only question that mattered — *does the product say Stamp?* — and the six
 * acceptance criteria that would have caught it were on the record, unchecked,
 * while the state moved to done anyway.
 *
 * Engineering checks passing is not the contract being met. This is the
 * structural version of that sentence: a write that moves a request into a
 * done state is refused while its own contract is unmet.
 *
 * Structural rather than prompted (a standing rule): a worker cannot talk its
 * way past this, because it is not asked.
 */

/** The states that mean a person should expect to use the thing. */
const DONE_STATES: ReadonlySet<string> = new Set(['shipped', 'accepted', 'released', 'answered']);

/** Surfaces a person can see, and therefore owes an after-shot. */
const VISIBLE_SURFACES: ReadonlySet<string> = new Set(['ui', 'flow']);

type Criterion = { statement?: unknown; met?: unknown };

function asArray(value: unknown): Criterion[] {
  return Array.isArray(value) ? value.filter((c): c is Criterion => typeof c === 'object' && c !== null) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

/**
 * Why this record may not be called done yet, or `undefined` when it may.
 *
 * `answered` is exempt from the visual rule: a question is closed by an
 * answer, and there is nothing to screenshot.
 * @param current - The record's metadata as it stands.
 * @param set - The fields being written.
 */
export function doneRefusal(current: Record<string, unknown>, set: Record<string, unknown>): string | undefined {
  const nextState = typeof set.state === 'string' ? set.state : null;
  if (nextState === null || !DONE_STATES.has(nextState)) {
    return undefined;
  }
  const merged = { ...current, ...set };
  const criteria = asArray(merged.acceptance);
  const unmet = criteria.filter(c => c.met !== true);
  if (criteria.length > 0 && unmet.length > 0) {
    const first = unmet.map(c => (typeof c.statement === 'string' ? c.statement : 'an unnamed criterion')).slice(0, 3);
    return `Not marked ${nextState}: ${unmet.length} of ${criteria.length} acceptance criteria are not met — ${first.join('; ')}${unmet.length > 3 ? '; …' : ''}. Check each one against the running product and record the evidence, or come back and change the contract. Passing engineering checks is not the contract being met.`;
  }
  const surface = typeof merged.surface === 'string' ? merged.surface : null;
  if (surface !== null && VISIBLE_SURFACES.has(surface) && nextState !== 'answered') {
    const visuals = asRecord(merged.visuals);
    const after = Array.isArray(visuals.afterArtifactIds) ? visuals.afterArtifactIds : [];
    const reason = typeof visuals.noVisualReason === 'string' ? visuals.noVisualReason.trim() : '';
    if (after.length === 0 && reason === '') {
      return `Not marked ${nextState}: this is a ${surface} change and nothing shows what it looks like now. Capture an after-shot from the running product, or record why there is nothing to show in visuals.noVisualReason. A visible change nobody has looked at is not finished.`;
    }
  }
  return undefined;
}
