/**
 * What a pile of proposals about one record would DO, in one line.
 *
 * "Deal 63861129354 — 17 proposals" told the reviewer the count and nothing
 * else (Chris, 2026-09-16: "a general summary of proposed changes, even if
 * super high level"). Seventeen proposals against one deal are in practice a
 * handful of kinds, and the payloads already say which: the action id and the
 * property names it writes.
 *
 * Read off those, in code. Never asked of a model: this renders on every list
 * paint, has to be the same string every time, and a summary that drifts is
 * worse than a count.
 */

export type ChangeBucket = {
  /** Singular noun for this kind of change — `field update`, `close-date change`. */
  label: string;
  /** The system the change lands in, said once when a summary is all one kind — `CRM`. */
  system?: string;
  count: number;
};

/** One proposed action, as much of it as the summary reads. */
export type SummarisableRun = { actionId: string; input: Record<string, unknown> };

/**
 * Property names worth naming in their own right. Everything else on a CRM
 * update is "a field", which is honest: the reviewer opens the sheet to see
 * which.
 */
const FIELD_BUCKET: Record<string, string> = {
  closedate: 'close-date change',
  dealstage: 'stage change',
  amount: 'amount change',
  hubspot_owner_id: 'owner change',
  hs_next_step: 'next step',
  lifecyclestage: 'lifecycle change',
  hs_lead_status: 'lead-status change',
};

/** Fields that name the record rather than change it — they do not make a bucket. */
const IDENTITY_FIELDS = new Set(['dealname', 'firstname', 'lastname', 'email', 'name', 'domain']);

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * `hubspot.update` → `HubSpot update`; used only when nothing more specific
 * knows the action.
 * @param actionId
 */
function fallbackLabel(actionId: string): string {
  const [system, verb] = actionId.split('.');
  return `${verb ? `${system} ${verb}` : actionId}`.replaceAll('_', ' ').toLowerCase();
}

/**
 * Which bucket one proposed action falls in. A CRM update that touches
 * several properties of the same kind keeps that kind; one that mixes kinds
 * is a field update, because no single name would be true of it.
 * @param run
 */
function bucketFor(run: SummarisableRun): { label: string; system?: string } {
  if (run.actionId === 'hubspot.update') {
    const fields = Object.keys(rec(run.input.properties)).filter(f => !IDENTITY_FIELDS.has(f));
    const named = [...new Set(fields.map(f => FIELD_BUCKET[f]).filter((l): l is string => l !== undefined))];
    return { label: named.length === 1 && named[0] && named.length === new Set(fields).size ? named[0] : 'field update', system: 'CRM' };
  }
  if (run.actionId === 'personalization.enroll') {
    return { label: 'enrollment' };
  }
  if (run.actionId === 'gmail.send') {
    return { label: run.input.draft === true ? 'email draft' : 'email' };
  }
  return { label: fallbackLabel(run.actionId) };
}

/**
 * Bucket a record's proposals, biggest first — and, at equal counts, in
 * alphabetical order, so the same set of proposals always reads the same way.
 * @param runs
 */
export function summariseChanges(runs: SummarisableRun[]): ChangeBucket[] {
  const buckets = new Map<string, ChangeBucket>();
  for (const run of runs) {
    const { label, system } = bucketFor(run);
    const found = buckets.get(label);
    if (found) {
      found.count += 1;
    } else {
      buckets.set(label, { label, count: 1, ...(system ? { system } : {}) });
    }
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * `deal` → `deals`. Deliberately dumb: every label in this file is a plain
 * English noun phrase ending in a regular noun, and a real pluraliser would
 * be a dependency in exchange for nothing.
 * @param label
 * @param count
 */
function plural(label: string, count: number): string {
  return count === 1 || label.endsWith('s') ? label : `${label}s`;
}

/**
 * The summary as a person reads it.
 *
 *   one kind      → `17 CRM field updates`
 *   several       → `12 field updates · 3 next steps · 2 close-date changes`
 *   more than 3   → the top three, then `+4 more`
 *
 * Empty for no runs — a caller drops the segment rather than printing "0".
 * @param buckets - From `summariseChanges`.
 */
export function changeSummaryLine(buckets: ChangeBucket[]): string {
  const first = buckets[0];
  if (!first) {
    return '';
  }
  if (buckets.length === 1) {
    // One kind, so there is room to say whose system it lands in.
    return `${first.count} ${first.system ? `${first.system} ` : ''}${plural(first.label, first.count)}`;
  }
  const shown = buckets.slice(0, 3);
  const rest = buckets.slice(3).reduce((n, b) => n + b.count, 0);
  return [...shown.map(b => `${b.count} ${plural(b.label, b.count)}`), ...(rest > 0 ? [`+${rest} more`] : [])].join(' · ');
}
