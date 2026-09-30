import type { RecordStatus } from '@/libs/factory/liveStatus';
import { hasReportPage, recordHrefFrom } from '@/libs/workspace/recordHref';
import { getBusinessObject } from '@/services/BusinessObjectService';
import { featureStatusOf } from '@/services/factory/featureReport';
import { loadFeatureReport } from '@/services/factory/featureReportData';
import { recordLinksForOrg } from './recordHref';

/**
 * ONE RECORD'S STATUS — You, Now, Next — for any record whose type has a
 * report page in this workspace (`libs/factory/liveStatus.ts`).
 *
 * Which types have one is the workspace's word, read from the pages it has
 * on (`recordLinksForOrg` → `reports`), never a type written here; the
 * report page's own assembly tells the story and this reads its status off
 * it, so the API, MCP, the chat line, the preview pane and the page say the
 * same thing (parity rule).
 */

export type RecordStatusRead
  = | { ok: true; status: RecordStatus }
    | { ok: false; reason: 'not_found' | 'no_report' };

/**
 * @param orgId - Tenant.
 * @param id - The record.
 * @param now - The clock.
 */
export async function loadRecordStatus(orgId: string, id: number, now: Date = new Date()): Promise<RecordStatusRead> {
  const row = await getBusinessObject(id, orgId);
  if (!row) {
    return { ok: false, reason: 'not_found' };
  }
  const objectType = row.type?.slug ?? null;
  const links = await recordLinksForOrg(orgId);
  if (!objectType || !hasReportPage(links, objectType)) {
    return { ok: false, reason: 'no_report' };
  }
  const report = await loadFeatureReport(orgId, id, now);
  if (!report) {
    return { ok: false, reason: 'no_report' };
  }
  return { ok: true, status: featureStatusOf(report, { objectType, href: recordHrefFrom(links, { objectType, id }) }, now) };
}
