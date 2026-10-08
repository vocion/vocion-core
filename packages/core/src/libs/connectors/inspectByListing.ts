/**
 * Test connection for a finance or people provider: one cheap read of each
 * kind of record it serves (a page of one), each a line on the checklist —
 * so a person sees not only that the key works but what it may read, and a
 * restricted key missing one permission says which.
 *
 * Read-only, and nothing is saved.
 */

import type { ConnectorCheck, ConnectorInspection } from '@/libs/sources/inspect';
import { VendorRequestError } from './vendorHttp';

type Listing = {
  vendor: string;
  kinds: readonly string[];
  list: (kind: never, query: { limit: number }) => Promise<{ records: unknown[] }>;
};

/**
 * Read one record of each kind and report.
 * @param provider - The provider, built from the candidate credential.
 * @param note - A line to show whatever the outcome (test mode, which organisation).
 */
export async function inspectByListing(provider: Listing, note: string | null = null): Promise<ConnectorInspection> {
  const checks: ConnectorCheck[] = [];
  let reachable = true;
  let authorized = true;
  for (const kind of provider.kinds) {
    const label = `Reads ${kind.replace('_', ' ')} records`;
    try {
      const page = await provider.list(kind as never, { limit: 1 });
      checks.push({ key: kind, label, ok: true, detail: page.records.length > 0 ? null : 'None yet.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({ key: kind, label, ok: false, detail: message });
      if (error instanceof VendorRequestError) {
        if (error.status === null) {
          reachable = false;
        }
        if (error.status === 401) {
          authorized = false;
        }
        if (error.fatal) {
          // A refused key or an unreachable host fails every other kind the same way.
          break;
        }
      }
    }
  }
  const failed = checks.filter(c => !c.ok);
  return {
    reachable,
    authorized,
    checks,
    note,
    error: failed.length === 0 ? null : failed.length === provider.kinds.length || !authorized || !reachable ? failed[0]!.detail : `${provider.vendor} reads ${checks.filter(c => c.ok).map(c => c.key).join(', ') || 'nothing'}; not ${failed.map(c => c.key).join(', ')}.`,
  };
}
