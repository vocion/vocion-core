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
 * True only when the stamp names a machine. No stamp is not known to be a
 * machine: older runs and some review paths leave it empty, and those keep
 * the standing a person's decision had before this existed.
 * @param decidedBy - The run's `decidedBy`.
 */
export function decidedByMachine(decidedBy: string | null | undefined): boolean {
  const by = (decidedBy ?? '').trim();
  return MACHINE_STAMPS.has(by) || MACHINE_PREFIXES.some(prefix => by.startsWith(prefix));
}
