/**
 * A PAUSED AUTOMATION THAT AN EVENT MATCHED IS SAID WHERE THE WORK IS
 * (2026-10-01, #294: `deploy-run-failed` had been paused since 21 September,
 * its status still read `active`, and the failed deploy it would have
 * answered sat for two hours with nothing on any page saying why).
 *
 * A pause is a person's choice and is not overridden. It is shown: the match
 * is written as a `skipped` run row on the automation (`automation_paused`),
 * and as one line on every record the event is about — "Would have run "A
 * failed deploy is an incident", but it is paused (since …, by …): Resume" —
 * so the page a person is looking at says what is not happening and the one
 * move that starts it again.
 *
 * Which records an event is about is read from the event's own fields, never
 * from its type: the records it names by id, the change it names by pull
 * request, the commit a merge's delivery carries, and the environments whose
 * deploy workflow ran. No type, workflow or automation is named here.
 */

import type { CausalChain } from '@/services/automations/fireGuards';
import { pausedSince } from '@/libs/factory/delivery';

type Meta = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const idOf = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** The most records one match is noted on. */
const MAX_RECORDS = 10;

/** An automation as a pause line reads it. */
export type PausedAutomation = { slug: string; name: string; pausedAt: Date; pausedBy: string | null; pausedNote: string | null };

/** The records an event is about: requests (their account) and others (their pipeline log). */
export type AffectedRecords = { requests: number[]; others: number[] };

/**
 * Who paused it, by name: a person's name, an API token's name, or the id.
 * @param orgId - Tenant.
 * @param by - `automation.paused_by`.
 */
export async function pauserName(orgId: string, by: string | null): Promise<string | null> {
  if (!by) {
    return null;
  }
  const { pausesFor } = await import('@/services/AutomationService');
  const pauses = await pausesFor([{ slug: '_', pausedAt: new Date(0), pausedBy: by, pausedNote: null }], orgId).catch(() => null);
  return pauses?.get('_')?.by.name ?? by;
}

/**
 * "Would have run "A failed deploy is an incident", but it is paused (since 21
 * Sep 13:01 UTC, by Dana: "hold the factory"). Resume it at /dashboard/automation/<slug>."
 * @param a - The automation.
 * @param byName - Who paused it, by name.
 * @param would - What it would have done, when the caller can say it better than the automation's name.
 */
export function pausedMatchLine(a: PausedAutomation, byName: string | null, would?: string): string {
  const who = byName ? `, by ${byName}` : '';
  const note = a.pausedNote ? `: "${a.pausedNote}"` : '';
  return `${would ?? `Would have run "${a.name}"`}, but "${a.name}" is paused (since ${pausedSince(a.pausedAt.toISOString())}${who}${note}). Resume it at /dashboard/automation/${a.slug} and it runs again.`;
}

/**
 * The records an event is about, read from its fields.
 * @param orgId - Tenant.
 * @param payload - The event's payload.
 */
export async function affectedRecords(orgId: string, payload: Meta): Promise<AffectedRecords> {
  const { and, eq, or, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  const types = await (await import('@/libs/factory/types')).factoryTypes(orgId).catch(() => null);
  const requests = new Set<number>();
  const others = new Set<number>();
  const place = (id: number, typeSlug: string | null, meta: Meta) => {
    if (types && typeSlug === types.request) {
      requests.add(id);
      return;
    }
    others.add(id);
    const parent = idOf(meta.requestId);
    if (parent) {
      requests.add(parent);
    }
  };

  // 1. The records it names by id.
  const record = payload.record && typeof payload.record === 'object' ? (payload.record as Meta).id : null;
  for (const id of [payload.requestId, payload.recordId, payload.taskId, record].map(idOf).filter((n): n is number => n !== null)) {
    const r = await readRecord(orgId, id).catch(() => null);
    if (r) {
      place(r.id, r.typeSlug, r.meta);
    }
  }

  // 2. The change it names (a pull request), and 3. the commit a merge's delivery carries.
  const url = str(payload.prUrl) ?? (/\/pull\/\d+/.test(str(payload.url) ?? '') ? str(payload.url) : null);
  const sha = str(payload.headSha) ?? str(payload.mergeSha);
  const clauses = [
    ...(url ? [sql`${businessObjectSchema.metadata} ->> 'prUrl' = ${url}`] : []),
    ...(sha ? [sql`${businessObjectSchema.metadata} -> 'delivery' ->> 'mergeSha' = ${sha}`] : []),
  ];
  if (clauses.length > 0) {
    const rows = await db.select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), or(...clauses))).limit(MAX_RECORDS);
    for (const row of rows) {
      const meta = (row.meta ?? {}) as Meta;
      if (meta.delivery && typeof meta.delivery === 'object') {
        requests.add(row.id);
      } else {
        place(row.id, null, meta);
      }
    }
  }

  // 4. A workflow run: the environments its workflow deploys.
  const repo = str(payload.repo);
  if (repo && idOf(payload.runId) && (str(payload.path) || str(payload.name))) {
    const { deploysWith, environmentRows } = await import('./environments');
    for (const env of await environmentRows(orgId).catch(() => [])) {
      if (env.repo?.toLowerCase() === repo.toLowerCase() && deploysWith(env.meta.deploy as Meta | null, { path: str(payload.path), name: str(payload.name) })) {
        others.add(env.id);
      }
    }
  }
  return { requests: [...requests].slice(0, MAX_RECORDS), others: [...others].slice(0, MAX_RECORDS) };
}

/**
 * Write one line on each record: a request's account, any other record's pipeline log.
 * @param orgId - Tenant.
 * @param records - Where.
 * @param line - What.
 * @param o - The link that proves it.
 * @param o.url - The run, pull request or page.
 */
export async function noteOnAffected(orgId: string, records: AffectedRecords, line: string, o: { url?: string | null } = {}): Promise<void> {
  const { noteOnRequest } = await import('./carry');
  const { noteOnRecord } = await import('./environments');
  for (const id of records.requests) {
    await noteOnRequest(orgId, id, line).catch(() => undefined);
  }
  for (const id of records.others) {
    await noteOnRecord(orgId, id, line, { url: o.url ?? null }).catch(() => undefined);
  }
}

/**
 * An event matched a paused automation: the refused match is a `skipped`
 * run row, and the records the event is about say what did not happen.
 * Never throws: a match that cannot be written is logged, not taken out on the event.
 * @param orgId - Tenant.
 * @param a - The paused automation.
 * @param o - The event.
 * @param o.event - Its type.
 * @param o.payload - Its payload.
 * @param o.causedBy - The chain it carried.
 * @param o.would - What it would have done, in the caller's words.
 * @param o.records - Where to say it, when the caller already knows.
 */
export async function recordPausedMatch(orgId: string, a: PausedAutomation, o: { event: string; payload: Meta; causedBy?: CausalChain | null; would?: string; records?: AffectedRecords }): Promise<{ automationRunId: number | null; line: string; records: AffectedRecords }> {
  const byName = await pauserName(orgId, a.pausedBy).catch(() => a.pausedBy);
  const line = pausedMatchLine(a, byName, o.would);
  let automationRunId: number | null = null;
  let records: AffectedRecords = o.records ?? { requests: [], others: [] };
  try {
    const { recordSkippedFire } = await import('@/services/AutomationService');
    automationRunId = await recordSkippedFire(orgId, a.slug, {
      event: o.event,
      payload: o.payload,
      result: { kind: 'skipped', reason: 'automation_paused', detail: line, event: o.event, causedBy: o.causedBy ?? null, paused: { since: a.pausedAt.toISOString(), by: byName, note: a.pausedNote } },
    });
    records = o.records ?? await affectedRecords(orgId, o.payload);
    await noteOnAffected(orgId, records, line, { url: str(o.payload.url) });
  } catch (err) {
    console.warn('[automations] a match on a paused automation could not be written', { orgId, slug: a.slug, event: o.event, message: (err as Error).message });
  }
  return { automationRunId, line, records };
}
