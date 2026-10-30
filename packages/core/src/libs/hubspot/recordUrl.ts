import type { HubspotClient } from './client';

/**
 * WHERE A HUBSPOT RECORD LIVES, as a page a person can open: its record page
 * in HubSpot. A run that changed a deal links the deal there, so the Done
 * line's name opens it (a teammate's walk, 2026-10-30: the run's id was read
 * as a workspace record, and its chip opened a preview of nothing).
 *
 * The portal comes from the HubSpot source's own config (`portalId`), else
 * from HubSpot (`/account-info/v3/details`). Best-effort: no portal, no link.
 */

/** HubSpot's object type ids, as its record URLs spell them. */
const OBJECT_TYPE_IDS: Record<string, string> = { contacts: '0-1', companies: '0-2', deals: '0-3' };

/**
 * The record's page in HubSpot, or null when its portal cannot be read.
 * @param client - A HubSpot client with the workspace's token.
 * @param objectType - `deals`, `contacts` or `companies`.
 * @param objectId - HubSpot's id for it.
 * @param configuredPortal - The source config's `portalId`, when it has one.
 */
export async function hubspotRecordUrl(client: HubspotClient, objectType: string, objectId: string, configuredPortal?: unknown): Promise<string | null> {
  const typeId = OBJECT_TYPE_IDS[objectType];
  if (!typeId || !/^\d+$/.test(objectId)) {
    return null;
  }
  try {
    let portalId = typeof configuredPortal === 'string' || typeof configuredPortal === 'number' ? String(configuredPortal) : null;
    if (!portalId) {
      const info = await client.get<{ portalId?: number | string }>('/account-info/v3/details');
      portalId = info.ok && info.data.portalId !== undefined ? String(info.data.portalId) : null;
    }
    return portalId && /^\d+$/.test(portalId) ? `https://app.hubspot.com/contacts/${portalId}/record/${typeId}/${objectId}` : null;
  } catch {
    return null;
  }
}
