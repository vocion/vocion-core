import type { BriefRow } from './PersonalizationQueue';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { leadBriefSchema } from '@/models/Schema';
import { contactUtmContentByRef } from '@/services/CrmRecordsService';
import { QUEUED_STATUS } from '@/services/PersonalizationQueueService';

/**
 * The rows the personalization queue draws, for the queue page and for the
 * bulk actions view, so both read the same leads. A lead with no brief is not
 * on either screen: it sits in `queued` until a brief exists or the tries run
 * out. Dates cross the server/client boundary as ISO strings.
 * @param orgId
 */
export async function loadQueueBriefRows(orgId: string): Promise<BriefRow[]> {
  const rows = await db
    .select()
    .from(leadBriefSchema)
    .where(and(eq(leadBriefSchema.orgId, orgId), ne(leadBriefSchema.status, QUEUED_STATUS)))
    .orderBy(desc(leadBriefSchema.briefedAt))
    .limit(500);
  // The lead magnet lives on the CRM mirror, not the ledger row: see
  // `contactUtmContentByRef` for why. A failed read drops the fact, never the queue.
  const magnets = await contactUtmContentByRef(orgId, rows.map(r => r.contactRef)).catch(() => new Map<string, string>());
  return rows.map(r => ({
    id: r.id,
    contactRef: r.contactRef,
    contactName: r.contactName,
    contactTitle: r.contactTitle,
    companyName: r.companyName,
    entranceSource: r.entranceSource,
    utmCampaign: r.utmCampaign,
    utmContent: magnets.get(r.contactRef) ?? null,
    engagementSent: r.engagementSent,
    engagementOpened: r.engagementOpened,
    status: r.status,
    confidence: r.confidence,
    mqlAt: r.mqlAt?.toISOString() ?? null,
    arrivedAt: r.arrivedAt?.toISOString() ?? null,
    briefedAt: r.briefedAt?.toISOString() ?? null,
  }));
}
