/**
 * WHAT THE MACHINE KEEPS FOR ITSELF (Chris, 2026-09-30, on #269: "I keep
 * getting refreshed every few seconds … Close the gap keeps running").
 *
 * A record carries marks nobody reads as the work: the designer's
 * "drawing, attempt 2" mark, the runs the factory already handled, the time
 * its rollups were last summed. Writing one is bookkeeping. In five minutes on
 * #269 four such writes each moved the feature page (a live notice, then a
 * re-read of the whole page) and each started two automations that did
 * nothing but say so.
 *
 * The type says which paths these are, in its schema — never a list here:
 *
 *     schema:
 *       x-bookkeeping: [visuals.mockupDraw, recovery.handledRunIds]
 *
 * A write that changes nothing outside them is QUIET: it raises no
 * `object.updated` (`objects.update_meta`), makes no body version
 * (`services/objects/recordBody.ts`) and publishes no live notice (the
 * `business_object` trigger, migration 0158, reads the same key). The value is
 * still written; the next change a person would see carries it to the page.
 *
 * Pure and client-safe.
 */

type Meta = Record<string, unknown>;

/**
 * The dot paths a type declares as bookkeeping (`x-bookkeeping`), or none.
 * @param schema - The type's schema.
 */
export function bookkeepingPaths(schema: unknown): string[] {
  const raw = (schema && typeof schema === 'object' ? (schema as Meta)['x-bookkeeping'] : null) as unknown;
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map(p => p.trim()) : [];
}

function clone(v: unknown): unknown {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v)) as unknown;
}

/**
 * The metadata with every bookkeeping path taken out — what a person reads.
 * @param meta - The record's metadata.
 * @param paths - {@link bookkeepingPaths}.
 */
export function withoutBookkeeping(meta: Meta | null | undefined, paths: readonly string[]): Meta {
  const out = (clone(meta ?? {}) ?? {}) as Meta;
  for (const path of paths) {
    const parts = path.split('.');
    let at: unknown = out;
    for (const part of parts.slice(0, -1)) {
      at = at && typeof at === 'object' && !Array.isArray(at) ? (at as Meta)[part] : undefined;
    }
    if (at && typeof at === 'object' && !Array.isArray(at)) {
      delete (at as Meta)[parts.at(-1)!];
    }
  }
  return out;
}

/**
 * Key-order-independent JSON, so a jsonb read-back is never a change.
 * @param v - Any JSON value.
 */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Meta).sort(([a], [b]) => a.localeCompare(b)))
    : x)) ?? 'undefined';
}

/**
 * The top-level fields whose value a person would see as changed: every key
 * that differs between before and after once bookkeeping is taken out, sorted.
 * Empty means the write was quiet — nothing changed, or only bookkeeping did.
 * @param before - The metadata before the write.
 * @param after - The metadata after it.
 * @param paths - {@link bookkeepingPaths}.
 * @param keys - Limit the comparison to these keys (the ones written); all keys otherwise.
 */
export function changedFields(before: Meta | null | undefined, after: Meta | null | undefined, paths: readonly string[], keys?: readonly string[]): string[] {
  const a = withoutBookkeeping(before, paths);
  const b = withoutBookkeeping(after, paths);
  const all = keys ?? [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return [...new Set(all)].filter(k => stable(a[k] ?? null) !== stable(b[k] ?? null)).sort();
}
