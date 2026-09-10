/**
 * HandoffTriggerService — the watcher that notices a lead has left the agent.
 *
 * A lead the reviewer enrolled is out of the agent's hands until the lead does
 * something: replies to a send, or books a meeting. Both show up on the
 * contact in HubSpot as timestamps (`hs_sales_email_last_replied`,
 * `hs_latest_meeting_activity`), the contacts sync mirrors them as metadata,
 * and this service diffs them after every sync against what it last saw on
 * the lead row. A timestamp that moved, and that postdates the enrollment
 * decision, is a trigger: one `lead.replied` or `lead.meeting_booked` event,
 * deduped on the timestamp itself, which the `handoff-on-*` automations turn
 * into a write-handoff-brief run (ticket 055).
 *
 * The guarantees are structural:
 *
 *   - **Once per signal.** The event's dedupe key is the observed timestamp,
 *     and the seen column moves up to it in the same pass, so a sync that runs
 *     twice fires nothing the second time.
 *   - **Nothing from before enrollment.** The first watch after Enroll finds
 *     the seen columns null and baselines them without firing unless the
 *     signal itself postdates the decision. A reply the lead sent months ago
 *     is not a handoff.
 *   - **Never fails the sync.** The caller wraps this in `watchForHandoffTriggers`;
 *     a database or dispatch error is logged and swallowed, the same contract
 *     as the sync-completed announcement.
 *
 * No lane changes, no review item, no approval: nothing about a handoff is
 * decided in the platform (Valerie, 2026-09-09). The skill writes the prep,
 * the platform saves it and posts it to HubSpot (056), and the person picks
 * it up on the contact.
 */

import type { CrmRecord } from '@/services/CrmRecordsService';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { leadBriefSchema } from '@/models/Schema';
import { queryCrmRecords } from '@/services/CrmRecordsService';

/** Lanes in which a lead is with the sequence and a reply or meeting means a handoff. */
export const WATCHED_STATUSES = ['handed_off', 'sent'] as const;

/** The mirror reads in pages of at most this many refs (`CrmRecordsService.MAX_LIMIT`). */
const PAGE = 200;

export type HandoffTriggerKind = 'reply' | 'meeting';

export type DetectedTrigger = {
  leadBriefId: number;
  contactRef: string;
  trigger: HandoffTriggerKind;
  observedAt: Date;
  /** What `emitEvent` did with it; `deduped` means an earlier pass already fired it. */
  deduped: boolean;
};

export type DetectHandoffTriggersResult = {
  /** Enrolled leads the pass looked at. */
  watched: number;
  /** Leads whose mirror record could not be read this pass; nothing changes for them. */
  unmirrored: number;
  /** Seen columns moved without an event: the signal predates the enrollment decision. */
  baselined: number;
  triggered: DetectedTrigger[];
};

function toDate(v: unknown): Date | null {
  if (v == null || v === '') {
    return null;
  }
  // HubSpot stamps either ISO 8601 or epoch milliseconds as a string.
  const raw = typeof v === 'number' ? v : /^\d{10,}$/.test(String(v)) ? Number(v) : String(v);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

type WatchedRow = {
  id: number;
  contactRef: string;
  contactName: string;
  decidedAt: Date | null;
  briefedAt: Date | null;
  createdAt: Date;
  handoffReplySeenAt: Date | null;
  handoffMeetingSeenAt: Date | null;
};

/**
 * The moment the lead left the agent's research and went to the sequence. A
 * signal older than this belongs to whatever happened before the engagement
 * and is baselined silently; only activity after it is a handoff.
 * @param row
 */
function enrollmentBaseline(row: WatchedRow): Date {
  return row.decidedAt ?? row.briefedAt ?? row.createdAt;
}

/**
 * One signal on one lead: decide whether it moved, and whether it fires.
 * @param observed - The mirror's timestamp for the signal, if any.
 * @param seen - What the watcher last recorded.
 * @param baseline - The enrollment moment.
 * @returns `fire` to emit and record, `baseline` to record silently, `none` to leave alone.
 */
export function classifySignal(observed: Date | null, seen: Date | null, baseline: Date): 'fire' | 'baseline' | 'none' {
  if (!observed) {
    return 'none';
  }
  if (seen && observed.getTime() <= seen.getTime()) {
    return 'none';
  }
  return observed.getTime() > baseline.getTime() ? 'fire' : 'baseline';
}

/**
 * Diff every enrolled lead's reply and meeting timestamps against what the
 * watcher last saw, fire an event for each new one, and record what was seen.
 * @param orgId - Tenant.
 * @param opts
 * @param opts.allowedSourceSlugs - Restrict the mirror read to these HubSpot sources.
 */
export async function detectHandoffTriggers(
  orgId: string,
  opts: { allowedSourceSlugs?: string[] } = {},
): Promise<DetectHandoffTriggersResult> {
  const rows: WatchedRow[] = await db
    .select({
      id: leadBriefSchema.id,
      contactRef: leadBriefSchema.contactRef,
      contactName: leadBriefSchema.contactName,
      decidedAt: leadBriefSchema.decidedAt,
      briefedAt: leadBriefSchema.briefedAt,
      createdAt: leadBriefSchema.createdAt,
      handoffReplySeenAt: leadBriefSchema.handoffReplySeenAt,
      handoffMeetingSeenAt: leadBriefSchema.handoffMeetingSeenAt,
    })
    .from(leadBriefSchema)
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      inArray(leadBriefSchema.status, [...WATCHED_STATUSES]),
    ));

  const result: DetectHandoffTriggersResult = { watched: rows.length, unmirrored: 0, baselined: 0, triggered: [] };
  if (rows.length === 0) {
    return result;
  }

  const records = new Map<string, CrmRecord>();
  const refs = rows.map(r => r.contactRef);
  for (let offset = 0; offset < refs.length; offset += PAGE) {
    const page = await queryCrmRecords(orgId, 'contacts', {
      refs: refs.slice(offset, offset + PAGE),
      limit: PAGE,
      allowedSourceSlugs: opts.allowedSourceSlugs,
    });
    for (const rec of page.records) {
      records.set(rec.ref, rec);
    }
  }

  const { emitEvent, LEAD_MEETING_BOOKED, LEAD_REPLIED } = await import('@/services/EventService');

  for (const row of rows) {
    const rec = records.get(row.contactRef);
    if (!rec) {
      result.unmirrored += 1;
      continue;
    }
    const baseline = enrollmentBaseline(row);
    const signals: Array<{ trigger: HandoffTriggerKind; observed: Date | null; seen: Date | null; column: 'handoffReplySeenAt' | 'handoffMeetingSeenAt' }> = [
      { trigger: 'reply', observed: toDate(rec.salesEmailLastRepliedAt), seen: row.handoffReplySeenAt, column: 'handoffReplySeenAt' },
      { trigger: 'meeting', observed: toDate(rec.latestMeetingActivityAt), seen: row.handoffMeetingSeenAt, column: 'handoffMeetingSeenAt' },
    ];
    const set: Partial<Record<'handoffReplySeenAt' | 'handoffMeetingSeenAt', Date>> = {};

    for (const s of signals) {
      const verdict = classifySignal(s.observed, s.seen, baseline);
      if (verdict === 'none') {
        continue;
      }
      set[s.column] = s.observed!;
      if (verdict === 'baseline') {
        result.baselined += 1;
        continue;
      }
      const observedAt = s.observed!.toISOString();
      const emitted = await emitEvent({
        orgId,
        type: s.trigger === 'reply' ? LEAD_REPLIED : LEAD_MEETING_BOOKED,
        payload: {
          leadBriefId: row.id,
          contactRef: row.contactRef,
          hubspotId: rec.hubspotId ?? row.contactRef.split(':')[1] ?? null,
          contactName: row.contactName,
          trigger: s.trigger,
          observedAt,
        },
        dedupeKey: `handoff:${s.trigger}:${row.contactRef}:${observedAt}`,
        invokedBy: 'handoff-watch',
      });
      result.triggered.push({ leadBriefId: row.id, contactRef: row.contactRef, trigger: s.trigger, observedAt: s.observed!, deduped: emitted.deduped });
    }

    if (Object.keys(set).length > 0) {
      await db.update(leadBriefSchema).set(set).where(eq(leadBriefSchema.id, row.id));
    }
  }

  return result;
}

/**
 * The sync-side entry point: run the watch and never let it fail the sync
 * that just completed. Mirrors `announceSyncCompleted`'s contract.
 * @param orgId
 * @param log - The caller's structured logger.
 */
export async function watchForHandoffTriggers(
  orgId: string,
  log: (level: 'warn' | 'error', message: string, properties: Record<string, unknown>) => void,
): Promise<DetectHandoffTriggersResult | null> {
  try {
    return await detectHandoffTriggers(orgId);
  } catch (err) {
    log('error', 'contacts synced but the handoff watch failed', {
      orgId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
