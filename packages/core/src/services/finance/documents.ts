/**
 * A finance record as a searchable document, and the sync that walks a
 * provider into them — one mapping for every finance connector that syncs,
 * so an invoice from Xero and one from NetSuite read the same way.
 *
 * The text is the record as a bookkeeper reads it: who, when, how much, what
 * is still owed, each line. "Overdue" is never written: it depends on today,
 * and a document is read later than it is written. The numbers an agent sums
 * or filters on are on metadata, and `uri` links back into the vendor.
 */

import type { FinanceProvider, FinanceRecord, FinanceRecordKind } from './types';
import type { SourceContext } from '@/libs/sources/types';
import type { IngestDoc } from '@/services/IngestionService';
import { VendorRequestError } from '@/libs/connectors/vendorHttp';

/** Records read per page while syncing. */
const SYNC_PAGE = 100;

/**
 * An amount for reading: `USD 12,500.00`.
 * @param amount - The number, in major units.
 * @param currency - The currency code, when known.
 */
export function money(amount: number | null, currency: string | null): string {
  if (amount === null) {
    return 'unknown';
  }
  const figure = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency.toUpperCase()} ${figure}` : figure;
}

/**
 * One record as a document.
 * @param provider - Whose record it is.
 * @param record - The record, ideally whole (with lines).
 */
export function financeRecordDoc(provider: Pick<FinanceProvider, 'kind' | 'vendor'>, record: FinanceRecord): IngestDoc {
  const label = record.kind.replace('_', ' ');
  const lines: string[] = [`${provider.vendor} · ${label}${record.number ? ` ${record.number}` : ''}`, record.title];
  if (record.party) {
    lines.push(`Party: ${record.party}`);
  }
  if (record.status) {
    lines.push(`Status: ${record.status}`);
  }
  if (record.date) {
    lines.push(`Date: ${record.date.slice(0, 10)}`);
  }
  if (record.dueDate) {
    lines.push(`Due: ${record.dueDate.slice(0, 10)}`);
  }
  if (record.amount !== null) {
    lines.push(`Amount: ${money(record.amount, record.currency)}`);
  }
  if (record.balance !== null) {
    lines.push(record.balance <= 0 ? 'Still owed: nothing (settled)' : `Still owed: ${money(record.balance, record.currency)}`);
  }
  for (const line of record.lines ?? []) {
    const qty = line.quantity !== null && line.quantity !== 1 ? `${line.quantity} × ` : '';
    lines.push(`- ${qty}${line.description}${line.amount !== null ? `: ${money(line.amount, record.currency)}` : ''}`);
  }
  for (const [key, value] of Object.entries(record.details ?? {})) {
    if (value !== null && value !== '') {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  const metadata: Record<string, unknown> = {
    objectType: record.kind,
    vendor: provider.kind,
    vendorId: record.id,
  };
  for (const [key, value] of Object.entries({ number: record.number, party: record.party, status: record.status, amount: record.amount, currency: record.currency, balance: record.balance, date: record.date, dueDate: record.dueDate, lastUpdatedAt: record.updatedAt })) {
    if (value !== null) {
      metadata[key] = value;
    }
  }
  return {
    externalId: `${provider.kind}:${record.kind}:${record.id}`,
    title: record.title,
    content: lines.join('\n'),
    ...(record.url ? { uri: record.url } : {}),
    lastModifiedAt: record.updatedAt ? new Date(record.updatedAt) : null,
    metadata,
  };
}

/**
 * Walk a provider's records of the given kinds into documents: every page,
 * only what changed since the watermark when there is one. A kind the
 * credential may not read is reported and the rest still sync; a refused
 * credential or a rate limit ends the run.
 * @param ctx - The sync context.
 * @param provider - The provider, built from this source's credential.
 * @param kinds - The kinds to sync, in order.
 * @yields One document per record read.
 */
export async function* syncFinanceRecords(ctx: SourceContext, provider: FinanceProvider, kinds: readonly FinanceRecordKind[]): AsyncIterable<IngestDoc> {
  for (const kind of kinds) {
    let cursor: string | null = null;
    for (let page = 0; page < 10_000; page += 1) {
      let result;
      try {
        result = await provider.list(kind, { limit: SYNC_PAGE, cursor, updatedSince: ctx.since ?? null });
      } catch (error) {
        if (error instanceof VendorRequestError && !error.fatal) {
          ctx.onProgress?.({ kind: 'error', message: error.message });
          break;
        }
        throw error;
      }
      for (const record of result.records) {
        const doc = financeRecordDoc(provider, record);
        ctx.onProgress?.({ kind: 'fetched', uri: doc.externalId });
        yield doc;
      }
      if (!result.nextCursor) {
        break;
      }
      cursor = result.nextCursor;
    }
  }
}
