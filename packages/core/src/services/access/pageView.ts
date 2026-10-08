/**
 * A dashboard page showing one record to the signed-in person — one line in
 * the page, after the record was found and before it is drawn:
 *
 *   await notePageView({ kind: 'object', id: obj.id });
 *
 * The session and the request's fingerprint are read here, so a page states
 * only what it shows. Nothing is recorded for a page that rendered no record
 * (a 404 returns before the call) or with no person signed in.
 */

import type { AccessAction } from './accessLog';
import { notePersonRead } from './accessLog';

/**
 * @param record - What the page shows, in the `RecordRef.type` vocabulary.
 * @param record.kind - `object`, `artifact`, `document`, …
 * @param record.id - Its id.
 * @param action - `view` unless the page hands the thing over whole.
 */
export async function notePageView(record: { kind: string; id: string | number }, action: AccessAction = 'view'): Promise<void> {
  try {
    const { clerkAuth } = await import('@/libs/Auth');
    const { orgId, userId, accountId } = await clerkAuth();
    await notePersonRead({ orgId, userId, accountId }, { action, record, via: 'page' });
  } catch (error) {
    console.error('[access-log] could not note a page view', { kind: record.kind, error: String(error) });
  }
}
