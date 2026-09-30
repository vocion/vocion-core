/**
 * Who decided an action run, read from its `decidedBy` stamp.
 *
 * A person's decision carries their user id (or the token they hold). A
 * machine's carries a namespaced handle: `agent:<slug>` when a seat withdrew
 * its own card or its budget retired it, `system:<name>` for a sweep,
 * `trust-ladder` when the confidence bar released it. Those are the only
 * stamps the code writes for a machine; this is the one place that knows them.
 */
const MACHINE_PREFIXES = ['agent:', 'system:', 'factory:', 'automation:', 'mission:'] as const;
const MACHINE_STAMPS = new Set(['trust-ladder']);

/**
 * True when a person decided the run, false for a machine or no stamp at all.
 * @param decidedBy - The run's `decidedBy`.
 */
export function decidedByPerson(decidedBy: string | null | undefined): boolean {
  const by = (decidedBy ?? '').trim();
  if (by === '' || MACHINE_STAMPS.has(by)) {
    return false;
  }
  return !MACHINE_PREFIXES.some(prefix => by.startsWith(prefix));
}
