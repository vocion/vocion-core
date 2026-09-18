/**
 * The vocabulary of "Review queue", free of I/O so a client component can read
 * it without dragging the database into its bundle. `InboxService` re-exports
 * everything here.
 */

/** Every kind a row can be. Order here is the order of the chips. */
export type InboxKind = 'proposal' | 'ruling' | 'approval' | 'merge' | 'input' | 'credential' | 'gate' | 'recommendation' | 'run' | 'learning';

export const INBOX_KINDS: readonly InboxKind[] = ['proposal', 'ruling', 'approval', 'merge', 'input', 'credential', 'gate', 'recommendation', 'run', 'learning'];

export function isInboxKind(value: unknown): value is InboxKind {
  return typeof value === 'string' && (INBOX_KINDS as readonly string[]).includes(value);
}

export type InboxTab = 'open' | 'snoozed' | 'decided';
export const INBOX_TABS: readonly InboxTab[] = ['open', 'snoozed', 'decided'];

export type InboxSort = 'oldest' | 'newest' | 'value' | 'confidence';
export const INBOX_SORTS: readonly InboxSort[] = ['oldest', 'newest', 'value', 'confidence'];

/**
 * The inbox kind for an ask kind. An unknown kind (a row written by a newer
 * core) is shown as an approval rather than dropped.
 * @param kind - The ask's `kind` column.
 */
export function kindForAsk(kind: string): InboxKind {
  return isInboxKind(kind) && kind !== 'proposal' && kind !== 'run' && kind !== 'learning' ? kind : 'approval';
}
