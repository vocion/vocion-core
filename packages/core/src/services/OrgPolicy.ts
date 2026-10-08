/**
 * How many Orgs a deployment holds, and the two refusals single mode makes.
 *
 * People call a tenant an **Org**. In the schema it is still a
 * `tenant_account` row, joined through `account_membership`; and in code
 * `orgId` means the WORKSPACE (`project.id`), not the Org. So identifiers here
 * say "account", and only the words a person reads say "Org".
 *
 * `VOCION_ORGS` (`libs/Env.ts`) picks the mode:
 *
 * - `single` (default) — a self-hosted, one-tenant install. One Org on the
 *   server, and each person in at most one. No Org switcher. Creating a second
 *   `tenant_account`, or accepting an invite that would put someone in a second
 *   Org, is refused here — structurally, in every path that writes those rows,
 *   rather than hidden in the interface.
 * - `multi` — Vocion Cloud. Any number of Orgs, a person in several, and an Org
 *   switcher above the workspace switcher.
 *
 * Paths that create Orgs or memberships, and which check what:
 *
 * - `services/InviteAcceptance.ts` (`/api/invites/accept`) — {@link secondOrgProblem}.
 * - `app/api/signup/route.ts` — {@link secondOrgProblem} (a brand-new user has no
 *   Org yet, so it only ever refuses on a racing duplicate).
 * - `scripts/create-local-user.ts` — {@link newOrgProblem} before it creates the
 *   first Org, and {@link secondOrgProblem} is moot: the user is new.
 * - Exempt, dev-only: `scripts/seed-demo.ts`, `scripts/seed-adoption-demo.ts`,
 *   the e2e fixture seeds and the unit-test fixtures.
 */

import type { DbTransaction } from '@/libs/DbTransaction';
import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, tenantAccountSchema } from '@/models/Schema';

export type OrgsMode = 'single' | 'multi';

/**
 * This deployment's Org mode. Read from `process.env` on every call (as
 * `enforcementEnabled()` is) so a test can flip it; `libs/Env.ts` declares and
 * validates the same variable.
 */
export function orgsMode(): OrgsMode {
  return process.env.VOCION_ORGS?.trim().toLowerCase() === 'multi' ? 'multi' : 'single';
}

type Executor = typeof db | DbTransaction;

/**
 * Why this person may not join the Org `accountId`, or null when they may.
 *
 * Multi mode never refuses. Single mode refuses only when the person already
 * belongs to a DIFFERENT Org: joining the one Org they are in (or their first)
 * is always fine.
 * @param userId - The person joining.
 * @param accountId - The Org (`tenant_account.id`) they would join.
 * @param exec - The database, or the transaction the membership is written in.
 * @returns A sentence for the person, or null.
 */
export async function secondOrgProblem(userId: string, accountId: string, exec: Executor = db): Promise<string | null> {
  if (orgsMode() === 'multi') {
    return null;
  }
  const [current] = await exec
    .select({ name: tenantAccountSchema.name })
    .from(accountMembershipSchema)
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, accountMembershipSchema.accountId))
    .where(and(eq(accountMembershipSchema.userId, userId), ne(accountMembershipSchema.accountId, accountId)))
    .orderBy(asc(accountMembershipSchema.createdAt))
    .limit(1);
  if (!current) {
    return null;
  }
  const [target] = await exec.select({ name: tenantAccountSchema.name }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId)).limit(1);
  const targetName = target?.name ?? 'another Org';
  return `This Vocion server runs a single Org, and you already belong to ${current.name}, so you can't also join ${targetName} here. Ask an admin of ${targetName} to invite a different email.`;
}

/**
 * Why a new Org may not be created on this server, or null when it may.
 * Single mode allows exactly one `tenant_account`.
 * @param exec - The database, or the transaction the Org is created in.
 * @returns A sentence for the operator, or null.
 */
export async function newOrgProblem(exec: Executor = db): Promise<string | null> {
  if (orgsMode() === 'multi') {
    return null;
  }
  const [existing] = await exec.select({ name: tenantAccountSchema.name }).from(tenantAccountSchema).limit(1);
  return existing
    ? `This Vocion server runs a single Org (${existing.name}) and cannot hold a second one. Set VOCION_ORGS=multi to run several Orgs.`
    : null;
}
