/**
 * Auto-join domains: the one way in without an invite, and only where an
 * operator opted in.
 *
 * `VOCION_AUTO_JOIN_DOMAINS` is a comma list of email domains
 * (`northwind.example, northwind-labs.example`). On a single-Org install, a
 * person who proves an address in one of them — a verified Google or
 * Microsoft address, or a clicked email link — and has no login and no invite
 * gets a login and joins the install's Org as a **member**: no admin role, and
 * no workspace beyond what any member of that Org reaches (their personal
 * workspace, plus the Org's shared workspaces unless access is enforced). The
 * decision is `decideSignIn`'s (`services/auth/signInDecision.ts`); this file
 * reads the setting and makes the login.
 *
 * Off by default (unset or empty). Never on a multi-Org server: there, which
 * Org a domain belongs to is each Org's own claim to make and verify, which is
 * per-Org domain capture — an enterprise extension's to add, not core's. The
 * seam it would use is {@link autoJoinPolicy}: the one place the policy for a
 * sign-in is read. On a multi-Org server it answers null, and
 * `autoJoinDomain` refuses a multi-Org policy anyway.
 *
 * Exact domains only: `northwind.example` takes `ana@northwind.example`, not a
 * subdomain and not a look-alike. A password cannot join this way — there is
 * no password before there is a login — so every login made here was proven by
 * the provider or by the mailbox.
 */

import type { AutoJoinPolicy } from './signInDecision';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import { orgsMode } from '@/services/OrgPolicy';
import { ensurePersonalProjectsForUser } from '@/services/workspace/personalProject';

function log(level: 'info' | 'warn' | 'error', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

/**
 * The domains `VOCION_AUTO_JOIN_DOMAINS` lists, lowercased, without `@`,
 * duplicates or blanks. Empty when unset.
 * @param raw - The setting; `process.env.VOCION_AUTO_JOIN_DOMAINS` by default.
 */
export function autoJoinDomains(raw: string | undefined = process.env.VOCION_AUTO_JOIN_DOMAINS): string[] {
  const domains = (raw ?? '')
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(d => d.includes('.') && !d.includes('@') && !/\s/.test(d));
  return [...new Set(domains)];
}

let warnedMulti = false;

/**
 * Who may join without an invite on this install, or null. The install's Org
 * is the one people belong to (single-Org installs hold exactly one; the empty
 * `Default` every database starts with does not count). Null when the setting
 * is empty, when this is a multi-Org server, or before anyone belongs to an
 * Org — the first admin is made on the instance (`create-local-user`), never
 * by a domain.
 */
export async function autoJoinPolicy(): Promise<AutoJoinPolicy | null> {
  const domains = autoJoinDomains();
  if (domains.length === 0) {
    return null;
  }
  if (orgsMode() === 'multi') {
    // Per-Org domain capture is an extension's to build; core does not guess
    // which of several Orgs a domain belongs to.
    if (!warnedMulti) {
      warnedMulti = true;
      log('warn', 'VOCION_AUTO_JOIN_DOMAINS is ignored on a multi-Org server; each Org invites its own people');
    }
    return null;
  }
  const [org] = await db
    .select({ id: tenantAccountSchema.id })
    .from(tenantAccountSchema)
    .innerJoin(accountMembershipSchema, eq(accountMembershipSchema.accountId, tenantAccountSchema.id))
    .orderBy(asc(accountMembershipSchema.createdAt))
    .limit(1);
  return org ? { domains, accountId: org.id } : null;
}

export type AutoJoinResult
  = | { ok: true; userId: string; accountId: string }
    | { ok: false; reason: 'exists' | 'no-org' };

/**
 * Make a login for a proven address in an auto-join domain, as a member of
 * the install's Org, then its personal workspace. The user and the membership
 * are written together; a login that appeared since the decision (two tabs)
 * wins, and nothing is made.
 * @param input - The person.
 * @param input.email - The proven address, lowercased.
 * @param input.name - The provider's name for the person, if any.
 * @param input.accountId - The Org the policy named.
 * @param input.domain - The listed domain the address matched, for the log.
 */
export async function joinByDomain(input: { email: string; name: string | null; accountId: string; domain: string }): Promise<AutoJoinResult> {
  if (orgsMode() === 'multi') {
    return { ok: false, reason: 'no-org' };
  }
  const userId = `usr-${randomUUID()}`;
  const created = await db.transaction(async (tx) => {
    const [org] = await tx.select({ id: tenantAccountSchema.id }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, input.accountId)).limit(1);
    if (!org) {
      return 'no-org' as const;
    }
    const inserted = await tx
      .insert(userSchema)
      .values({ id: userId, email: input.email, name: input.name?.trim() || null, passwordHash: null, emailVerified: new Date() })
      .onConflictDoNothing({ target: userSchema.email })
      .returning({ id: userSchema.id });
    if (inserted.length === 0) {
      return 'exists' as const;
    }
    await tx.insert(accountMembershipSchema).values({ accountId: input.accountId, userId, role: 'member' });
    return 'created' as const;
  });
  if (created !== 'created') {
    return { ok: false, reason: created };
  }
  log('info', 'login made from an auto-join domain', { userId, domain: input.domain });
  await ensurePersonalProjectsForUser(userId);
  return { ok: true, userId, accountId: input.accountId };
}
