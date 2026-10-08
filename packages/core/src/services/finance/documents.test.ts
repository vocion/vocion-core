import type { FinanceProvider, FinanceRecord } from './types';
import type { SourceContext } from '@/libs/sources/types';
import { describe, expect, it } from 'vitest';
import { VendorRequestError } from '@/libs/connectors/vendorHttp';
import { financeRecordDoc, syncFinanceRecords } from './documents';

const INVOICE: FinanceRecord = {
  kind: 'invoice',
  id: 'inv-0001',
  number: 'INV-0042',
  title: 'Invoice INV-0042 · Contoso Supply',
  party: 'Contoso Supply',
  status: 'AUTHORISED',
  amount: 12500,
  currency: 'USD',
  balance: 10000,
  date: '2026-09-21',
  dueDate: '2026-10-21',
  updatedAt: '2026-09-22T10:00:00.000Z',
  url: 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=inv-0001',
  lines: [{ description: 'Implementation, phase 1', quantity: 1, amount: 12500 }],
};

describe('financeRecordDoc', () => {
  it('reads like a bookkeeper wrote it, never says overdue, and keeps the numbers on metadata', () => {
    const doc = financeRecordDoc({ kind: 'xero', vendor: 'Xero' }, INVOICE);

    expect(doc.externalId).toBe('xero:invoice:inv-0001');
    expect(doc.uri).toBe(INVOICE.url);
    expect(doc.content).toContain('Xero · invoice INV-0042');
    expect(doc.content).toContain('Still owed: USD 10,000.00');
    expect(doc.content).toContain('- Implementation, phase 1: USD 12,500.00');
    expect(doc.content).not.toMatch(/overdue/i);
    expect(doc.metadata).toMatchObject({ objectType: 'invoice', vendor: 'xero', amount: 12500, balance: 10000, dueDate: '2026-10-21', party: 'Contoso Supply' });
  });
});

describe('syncFinanceRecords', () => {
  it('walks every page of each kind from the watermark, and reports a kind it may not read while the rest sync', async () => {
    const asked: Array<{ kind: string; cursor: string | null | undefined; updatedSince: Date | null | undefined }> = [];
    const provider: FinanceProvider = {
      kind: 'xero',
      vendor: 'Xero',
      sourceSlug: 'books',
      kinds: ['invoice', 'bill', 'payment'],
      async list(kind, q) {
        asked.push({ kind, cursor: q.cursor, updatedSince: q.updatedSince });
        if (kind === 'bill') {
          throw new VendorRequestError('Xero would not let this credential read bills (403).', 403, false);
        }
        if (kind === 'invoice' && !q.cursor) {
          return { records: [INVOICE], nextCursor: '2' };
        }
        return { records: kind === 'invoice' ? [{ ...INVOICE, id: 'inv-0002' }] : [], nextCursor: null };
      },
      get: async () => INVOICE,
    };
    const errors: string[] = [];
    const since = new Date('2026-09-01T00:00:00Z');
    const ctx = { sourceId: 1, orgId: 'org_a', config: {}, since, onProgress: (e: { kind: string; message?: string }) => e.kind === 'error' && errors.push(e.message!) } as SourceContext;
    const docs = [];
    for await (const doc of syncFinanceRecords(ctx, provider, provider.kinds)) {
      docs.push(doc);
    }

    expect(docs.map(d => d.externalId)).toEqual(['xero:invoice:inv-0001', 'xero:invoice:inv-0002']);
    expect(asked.map(a => `${a.kind}:${a.cursor ?? '-'}`)).toEqual(['invoice:-', 'invoice:2', 'bill:-', 'payment:-']);
    expect(asked.every(a => a.updatedSince === since)).toBe(true);
    expect(errors).toEqual(['Xero would not let this credential read bills (403).']);
  });

  it('ends the run on a refused credential rather than reporting it per kind', async () => {
    const provider = {
      kind: 'xero',
      vendor: 'Xero',
      sourceSlug: 'books',
      kinds: ['invoice', 'bill'],
      list: async () => {
        throw new VendorRequestError('Xero refused the credential (401).', 401, true);
      },
      get: async () => INVOICE,
    } as FinanceProvider;
    const run = async () => {
      for await (const _doc of syncFinanceRecords({ sourceId: 1, orgId: 'o', config: {} }, provider, provider.kinds)) {
        // nothing
      }
    };

    await expect(run()).rejects.toThrow(/401/);
  });
});
