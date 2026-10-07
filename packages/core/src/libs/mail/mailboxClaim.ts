import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { isUniqueViolation } from '@/libs/dbErrors';
import { projectSchema } from '@/models/Schema';

/**
 * Who holds a mailbox address, and what to tell a workspace that asked for one
 * already taken.
 *
 * Mail is routed by the address it was sent to (`resolveMailbox`), so an
 * address held by two workspaces puts one company's mail in another's
 * workspace. Every writer of `project.mailbox_*` asks `mailboxHolder` first
 * and refuses with `mailboxClaimedMessage`; the partial unique index from
 * migration 0178 is what holds when two writers race, and
 * `isMailboxClaimConflict` recognises its refusal.
 *
 * Kept apart from `mailbox.ts`, whose helpers are pure: this one reads the
 * database. Neither imports the agent runtime, so the applier — which runs
 * inside the durable executor — can use both.
 */

/** The index that holds one workspace per address (migration 0178). */
const MAILBOX_ADDRESS_INDEX = 'project_mailbox_address_uq';

/** The workspace holding an address. */
type MailboxHolder = { projectId: string; slug: string; accountId: string };

/**
 * The workspace other than `exceptProjectId` whose enabled mailbox is this
 * address, compared case-insensitively as the read compares it.
 * @param address - The address being claimed.
 * @param exceptProjectId - The workspace claiming it; holding it already is not a conflict.
 */
export async function mailboxHolder(address: string, exceptProjectId: string): Promise<MailboxHolder | null> {
  const [row] = await db
    .select({ projectId: projectSchema.id, slug: projectSchema.slug, accountId: projectSchema.accountId })
    .from(projectSchema)
    .where(and(
      eq(projectSchema.mailboxEnabled, true),
      sql`lower(${projectSchema.mailboxAddress}) = ${address.toLowerCase()}`,
      ne(projectSchema.id, exceptProjectId),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * What to tell a workspace that asked for an address another one holds.
 *
 * Names the holder only when it is in the asker's own account. Across accounts
 * it says "another workspace on this deployment" and no more: which other
 * companies are hosted here is not the asker's business.
 * @param address - The address asked for.
 * @param holder - Who holds it, when known.
 * @param askerAccountId - The account of the workspace asking.
 */
export function mailboxClaimedMessage(address: string, holder: MailboxHolder | null, askerAccountId: string | null): string {
  if (holder && askerAccountId && holder.accountId === askerAccountId) {
    return `mailbox address "${address}" is already the mailbox of the "${holder.slug}" workspace. `
      + 'Give this workspace an address of its own with mailbox.address, or turn that workspace\'s mailbox off first.';
  }
  return `mailbox address "${address}" is already claimed by another workspace on this deployment. `
    + 'Give this workspace an address of its own with mailbox.address.';
}

/**
 * Whether a write was refused because another workspace holds the address —
 * the index catching a claim that raced past `mailboxHolder`.
 * @param error - Whatever the write threw.
 */
export function isMailboxClaimConflict(error: unknown): boolean {
  return isUniqueViolation(error, MAILBOX_ADDRESS_INDEX);
}
