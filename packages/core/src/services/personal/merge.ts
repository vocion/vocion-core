/**
 * FOLD A PERSON'S PER-ORG PERSONALS INTO THEIR ONE PERSONAL.
 *
 * Before one-Personal-per-person (`workspace/personalProject.ts`) a person in
 * several Orgs had one Personal on each. This moves what was theirs from the
 * others into the one that stays (the one on their home Org, else the oldest)
 * and archives the rest. Per person, in one transaction; dry run by default,
 * which reports per-table counts and writes nothing; idempotent, because an
 * archived Personal is never folded again.
 *
 * What moves, because it is the person's:
 * - conversations (their messages follow) and briefs;
 * - personal connections (`api_token` logins), re-sealed under the kept
 *   Personal's own key; a login the kept one already holds for the same
 *   vendor account is withdrawn rather than duplicated;
 * - their views and query log, notifications, asks, and memory (a
 *   namespace, view or memory key the kept Personal already has is left
 *   behind with the archive rather than overwritten);
 * - one daily rhythm, on the home Org (the others are dropped, so nobody is
 *   briefed twice).
 *
 * What stays with the archived workspace, on purpose:
 * - spend (`agent_budget`): it was charged to that Org and stays charged there;
 * - agents (the duplicate assistant), members, UI preferences;
 * - synced knowledge: it re-syncs into the kept Personal from the moved
 *   connection on its next run.
 */

import type { DbTransaction } from '@/libs/DbTransaction';
import { Buffer } from 'node:buffer';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { apiTokenSchema, personalRhythmSchema, projectSchema } from '@/models/Schema';
import { homeAccountFor, personalProjectsOf } from '@/services/workspace/personalProject';

/** The tables that move, keyed `org_id`; `project_id` follows where a table has one. */
const MOVED = ['conversation', 'briefing', 'state_view', 'state_query_log', 'notification', 'ask', 'memory_namespace', 'memory'] as const;

export type FoldReport = {
  userId: string;
  keep: { id: string; accountId: string };
  folds: Array<{ id: string; accountId: string; counts: Record<string, number> }>;
  /** Rows left behind because the kept Personal already has their key. */
  skipped: Record<string, number>;
  /** Rhythm rows dropped so the person is briefed once. */
  rhythmsDropped: number;
};

/**
 * Everyone with more than one live Personal.
 * @param userId - Only this person.
 */
export async function peopleToFold(userId?: string): Promise<string[]> {
  const rows = await db
    .select({ userId: projectSchema.ownerUserId, n: sql<number>`count(*)::int` })
    .from(projectSchema)
    .where(and(eq(projectSchema.kind, 'personal'), isNull(projectSchema.archivedAt), userId ? eq(projectSchema.ownerUserId, userId) : undefined))
    .groupBy(projectSchema.ownerUserId);
  return rows.filter(r => r.userId && r.n > 1).map(r => r.userId!);
}

type Exec = typeof db | DbTransaction;

async function countIn(exec: Exec, table: string, orgId: string): Promise<number> {
  const res = await exec.execute(sql`select count(*)::int as n from ${sql.identifier(table)} where org_id = ${orgId}`);
  return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
}

async function hasProjectId(exec: Exec, table: string): Promise<boolean> {
  const res = await exec.execute(sql`select 1 from information_schema.columns where table_schema = current_schema() and table_name = ${table} and column_name = 'project_id'`);
  return res.rows.length > 0;
}

/**
 * Move one table's rows from `from` to `to`, leaving behind any row whose
 * unique key the kept Personal already holds. Returns [moved, left behind].
 * @param tx - The transaction.
 * @param table - The table.
 * @param from - The Personal folded.
 * @param to - The Personal kept.
 */
async function moveTable(tx: DbTransaction, table: typeof MOVED[number], from: string, to: string): Promise<[number, number]> {
  const before = await countIn(tx, table, from);
  const t = sql.identifier(table);
  const project = (await hasProjectId(tx, table)) ? sql`, project_id = ${to}` : sql``;
  // The keys a table is unique on besides its id, so a row the kept Personal
  // already has is left with the archive rather than colliding.
  const clash = table === 'state_view'
    ? sql`and not exists (select 1 from state_view k where k.org_id = ${to} and k.scope = x.scope and k.user_id is not distinct from x.user_id and k.slug = x.slug)`
    : table === 'memory_namespace'
      ? sql`and not exists (select 1 from memory_namespace k where k.org_id = ${to} and (k.name = x.name or k.path = x.path))`
      : table === 'memory'
        ? sql`and not exists (select 1 from memory k where k.org_id = ${to} and k.namespace = x.namespace and k.key = x.key)`
        : sql``;
  await tx.execute(sql`update ${t} as x set org_id = ${to}${project} where x.org_id = ${from} ${clash}`);
  const left = await countIn(tx, table, from);
  return [before - left, left];
}

/**
 * Personal connections from `from` to `to`: decrypted under the folded
 * Personal's key and sealed under the kept one's. A login the kept Personal
 * already holds live for the same vendor account is withdrawn instead.
 * @param tx - The transaction.
 * @param from - The Personal folded.
 * @param to - The Personal kept.
 * @param apply - Whether to write.
 */
async function moveLogins(tx: DbTransaction, from: string, to: string, apply: boolean): Promise<[number, number]> {
  const rows = await tx.select().from(apiTokenSchema).where(and(eq(apiTokenSchema.orgId, from), eq(apiTokenSchema.obtainedVia, 'login')));
  const kept = await tx.select({ platform: apiTokenSchema.platform, account: apiTokenSchema.account }).from(apiTokenSchema).where(and(eq(apiTokenSchema.orgId, to), eq(apiTokenSchema.obtainedVia, 'login'), isNull(apiTokenSchema.revokedAt)));
  const vault = apply ? buildCredentialVault() : null;
  let moved = 0;
  let dropped = 0;
  for (const r of rows) {
    const duplicate = !r.revokedAt && kept.some(k => k.platform === r.platform && (k.account ?? '') === (r.account ?? ''));
    if (duplicate || !r.ciphertext || !r.nonce || !r.authTag || !r.dekId) {
      dropped += 1;
      if (apply && !r.revokedAt) {
        await tx.update(apiTokenSchema).set({ revokedAt: new Date() }).where(eq(apiTokenSchema.id, r.id));
      }
      continue;
    }
    moved += 1;
    if (vault) {
      const plain = await vault.decrypt(from, r.ciphertext, r.nonce, r.authTag, r.dekId);
      const sealed = await vault.encrypt(to, Buffer.from(plain));
      await tx.update(apiTokenSchema).set({ orgId: to, ciphertext: sealed.ciphertext, nonce: sealed.nonce, authTag: sealed.authTag, dekId: sealed.dekId }).where(eq(apiTokenSchema.id, r.id));
    }
  }
  return [moved, dropped];
}

/** Thrown inside a dry run's transaction so nothing it did is kept. */
class DryRun extends Error {}

/**
 * Fold one person's Personals.
 * @param userId - The person.
 * @param opts - What to do.
 * @param opts.apply - Write (default false: report only).
 * @param opts.now - The clock.
 */
export async function foldPersonals(userId: string, opts: { apply?: boolean; now?: Date } = {}): Promise<FoldReport | null> {
  const home = await homeAccountFor(userId);
  const mine = await personalProjectsOf(userId, home);
  const [keep, ...folds] = mine;
  if (!keep || folds.length === 0) {
    return null;
  }
  const report: FoldReport = { userId, keep: { id: keep.id, accountId: keep.accountId }, folds: [], skipped: {}, rhythmsDropped: 0 };
  const now = opts.now ?? new Date();
  try {
    await db.transaction(async (tx) => {
      for (const f of folds) {
        const counts: Record<string, number> = {};
        for (const table of MOVED) {
          const [moved, left] = await moveTable(tx, table, f.id, keep.id);
          counts[table] = moved;
          if (left > 0) {
            report.skipped[table] = (report.skipped[table] ?? 0) + left;
          }
        }
        const [logins, dropped] = await moveLogins(tx, f.id, keep.id, Boolean(opts.apply));
        counts.personal_connections = logins;
        if (dropped > 0) {
          report.skipped.personal_connections = (report.skipped.personal_connections ?? 0) + dropped;
        }
        await tx.update(projectSchema).set({ archivedAt: now, name: 'Personal (merged)' }).where(eq(projectSchema.id, f.id));
        report.folds.push({ id: f.id, accountId: f.accountId, counts });
      }
      // One rhythm, on the Org the kept Personal is on.
      const rhythms = await tx.select({ accountId: personalRhythmSchema.accountId }).from(personalRhythmSchema).where(eq(personalRhythmSchema.userId, userId));
      const others = rhythms.filter(r => r.accountId !== keep.accountId).map(r => r.accountId);
      if (others.length > 0) {
        if (!rhythms.some(r => r.accountId === keep.accountId)) {
          const [first] = others.splice(0, 1);
          await tx.update(personalRhythmSchema).set({ accountId: keep.accountId }).where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, first!)));
        }
        if (others.length > 0) {
          await tx.delete(personalRhythmSchema).where(and(eq(personalRhythmSchema.userId, userId), inArray(personalRhythmSchema.accountId, others)));
        }
        report.rhythmsDropped = others.length;
      }
      if (!opts.apply) {
        throw new DryRun('dry run');
      }
    });
  } catch (error) {
    if (!(error instanceof DryRun)) {
      throw error;
    }
  }
  return report;
}

/**
 * Fold everyone's Personals (or one person's).
 * @param opts - What to do.
 * @param opts.apply - Write (default false).
 * @param opts.userId - Only this person.
 */
export async function mergePersonalProjects(opts: { apply?: boolean; userId?: string } = {}): Promise<FoldReport[]> {
  const out: FoldReport[] = [];
  for (const userId of await peopleToFold(opts.userId)) {
    const r = await foldPersonals(userId, { apply: opts.apply });
    if (r) {
      out.push(r);
    }
  }
  return out;
}
