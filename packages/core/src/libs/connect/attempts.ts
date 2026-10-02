import type { DbTransaction } from '@/libs/DbTransaction';
/**
 * Connect attempts, recorded with their date (#1080).
 *
 * Every provider login the OAuth callback finishes, good or bad, is one
 * `source_audit` row (`connected` or `failed_auth`). The card and the
 * Connectors page read the newest one per connector, so a person who sees a
 * failure is also told when it happened. Wording lives in `attemptWording.ts`
 * because the browser renders it.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { sourceAuditSchema } from '@/models/Schema';
import { connectFailureSummary } from './attemptWording';

export type ConnectAttempt = {
  connector: string;
  provider: string;
  ok: boolean;
  reason: string | null;
  /** The failure in a person's words; null for a success. */
  summary: string | null;
  at: Date;
  userId: string | null;
};

/**
 * Write one attempt to `source_audit`, with provider, connector, reason and
 * the worded summary in metadata. Pass `tx` to join the caller's transaction.
 * @param input - Who tried, which provider and connector, and how it went.
 * @param input.orgId
 * @param input.userId
 * @param input.provider
 * @param input.providerLabel
 * @param input.connector
 * @param input.ok
 * @param input.reason
 * @param input.tx
 */
export async function recordConnectAttempt(input: {
  orgId: string;
  userId: string;
  provider: string;
  providerLabel: string;
  connector: string;
  ok: boolean;
  reason?: string;
  tx?: DbTransaction;
}): Promise<void> {
  const reason = input.ok ? null : (input.reason ?? null);
  await (input.tx ?? db).insert(sourceAuditSchema).values({
    orgId: input.orgId,
    userId: input.userId,
    event: input.ok ? 'connected' : 'failed_auth',
    metadata: {
      provider: input.provider,
      connector: input.connector,
      reason,
      summary: input.ok ? null : connectFailureSummary(input.providerLabel, reason),
    },
  });
}

type AttemptRow = {
  event: string;
  user_id: string | null;
  at: string | Date;
  provider: string | null;
  connector: string;
  reason: string | null;
  summary: string | null;
};

/**
 * The newest attempt per connector for a workspace, in one query
 * (DISTINCT ON connector, newest first).
 * @param orgId - The workspace.
 */
export async function lastConnectAttempts(orgId: string): Promise<Map<string, ConnectAttempt>> {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (metadata->>'connector')
      event,
      user_id,
      to_char(at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,
      metadata->>'provider' AS provider,
      metadata->>'connector' AS connector,
      metadata->>'reason' AS reason,
      metadata->>'summary' AS summary
    FROM source_audit
    WHERE org_id = ${orgId}
      AND event IN ('connected', 'failed_auth')
      AND metadata->>'connector' IS NOT NULL
    ORDER BY metadata->>'connector', at DESC, id DESC
  `);
  // `at` is a timestamp without a zone that drizzle writes in UTC; the `Z` in the
  // to_char above stops the JS side from reading it as local time.
  // `db.execute` hands back `{ rows }` on the Postgres driver and a bare array on others.
  const rows = (Array.isArray(result) ? result : (result as unknown as { rows: AttemptRow[] }).rows) as AttemptRow[];
  const attempts = new Map<string, ConnectAttempt>();
  for (const row of rows) {
    attempts.set(row.connector, {
      connector: row.connector,
      provider: row.provider ?? row.connector,
      ok: row.event === 'connected',
      reason: row.reason,
      summary: row.summary,
      at: new Date(row.at),
      userId: row.user_id,
    });
  }
  return attempts;
}
