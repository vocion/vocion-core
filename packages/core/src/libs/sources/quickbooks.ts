/**
 * QuickBooks Online connector — a company's books as searchable documents,
 * read-only: the chart of accounts, invoices, bills, payments received, bill
 * payments made, and journal entries. One document per record, its text the
 * record as a bookkeeper would read it (who, when, what, how much, what is
 * still owed), its numbers on metadata so they can be summed and filtered.
 *
 * Auth: a "Connect with QuickBooks" login (`libs/connect/providers/quickbooks.ts`)
 * — an access token, a refresh token that Intuit rotates, and the company it
 * was granted for. A sync refreshes an expiring grant and saves the rotated
 * token (`usableLoginGrant`). One login is one company; a firm with several
 * companies logs in once per company, and each source reads the one it is
 * linked to.
 *
 * `sample: true` reads a fictional company held in memory
 * (`libs/quickbooks/sampleCompany.ts`) through the same mapping, with no
 * login at all, so the connector can be tried — by a person, an agent or a
 * demo — before anyone sets up an Intuit app. Every sample document says so
 * in its title, its text and its metadata.
 *
 * Incremental: with `ctx.since`, each query asks only for records whose
 * `Metadata.LastUpdatedTime` is at or after it. A deleted record never shows
 * up in that, so a daily full reconcile prunes them.
 */

import type { SourceConnector, SourceContext } from './types';
import type { QuickbooksEntity, QuickbooksReader, QuickbooksRow } from '@/libs/quickbooks/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { refreshQuickbooksGrant } from '@/libs/connect/providers/quickbooks';
import { liveQuickbooksReader, QUICKBOOKS_API_BASE, QUICKBOOKS_PAGE_SIZE, QuickbooksQueryError } from '@/libs/quickbooks/client';
import { SAMPLE_COMPANY_NAME, sampleQuickbooksReader } from '@/libs/quickbooks/sampleCompany';

const quickbooksConfigSchema = z.object({
  /** Read the fictional sample company instead of a connected one. Needs no login. */
  sample: z.boolean().default(false),
  /** Override the API host. Unset: the host of the environment the login was made in. */
  baseUrl: z.string().url().optional(),
});

/** The entities read, in the order a sync reads them. */
const ENTITIES: readonly QuickbooksEntity[] = ['Account', 'Invoice', 'Bill', 'Payment', 'BillPayment', 'JournalEntry'];

/** Each entity's document type, as it appears in ids and metadata. */
const OBJECT_TYPE: Record<QuickbooksEntity, string> = {
  Account: 'account',
  Invoice: 'invoice',
  Bill: 'bill',
  Payment: 'payment',
  BillPayment: 'bill-payment',
  JournalEntry: 'journal-entry',
};

/** Where each entity opens in QuickBooks, under the app host. */
const APP_PATH: Record<QuickbooksEntity, (id: string) => string> = {
  Account: id => `/app/register?accountId=${encodeURIComponent(id)}`,
  Invoice: id => `/app/invoice?txnId=${encodeURIComponent(id)}`,
  Bill: id => `/app/bill?txnId=${encodeURIComponent(id)}`,
  Payment: id => `/app/recvpayment?txnId=${encodeURIComponent(id)}`,
  BillPayment: id => `/app/billpayment?txnId=${encodeURIComponent(id)}`,
  JournalEntry: id => `/app/journal?txnId=${encodeURIComponent(id)}`,
};

/**
 * A string field, or undefined.
 * @param value - Anything.
 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * A number field, or undefined. QuickBooks sends amounts as JSON numbers.
 * @param value - Anything.
 */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The name on a reference (`CustomerRef`, `AccountRef`), or undefined.
 * @param ref - The reference object.
 */
function refName(ref: unknown): string | undefined {
  return ref && typeof ref === 'object' ? text((ref as { name?: unknown }).name) : undefined;
}

/**
 * The value on a reference: its id, or for `CurrencyRef` the currency code.
 * @param ref - The reference object.
 */
function refValue(ref: unknown): string | undefined {
  return ref && typeof ref === 'object' ? text((ref as { value?: unknown }).value) : undefined;
}

/**
 * An amount for reading: `USD 12,500.00`.
 * @param amount - The number.
 * @param currency - The currency code, when known.
 */
function money(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined) {
    return 'unknown';
  }
  const figure = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${figure}` : figure;
}

/**
 * Whether an invoice or bill is settled, from its balance against its total.
 * Never "overdue": that depends on today, and a document is read later than
 * it is written. The due date is beside it for whoever reads it.
 * @param total - The total.
 * @param balance - What is still owed.
 */
function settlement(total: number | undefined, balance: number | undefined): 'paid' | 'partly paid' | 'unpaid' | undefined {
  if (total === undefined || balance === undefined) {
    return undefined;
  }
  if (balance <= 0) {
    return 'paid';
  }
  return balance < total ? 'partly paid' : 'unpaid';
}

/**
 * The rows of a transaction's `Line` array.
 * @param row - The transaction.
 */
function lines(row: QuickbooksRow): QuickbooksRow[] {
  return Array.isArray(row.Line) ? row.Line.filter((line): line is QuickbooksRow => Boolean(line) && typeof line === 'object') : [];
}

/**
 * One invoice or bill line, as a bullet: what, how many at what, how much.
 * A subtotal line is not an item, so it is left out.
 * @param line - The line.
 * @param currency - The transaction's currency.
 */
function itemLine(line: QuickbooksRow, currency: string | undefined): string | null {
  const type = text(line.DetailType);
  if (type === 'SubTotalLineDetail') {
    return null;
  }
  const detail = (type && line[type] && typeof line[type] === 'object' ? line[type] : {}) as Record<string, unknown>;
  const what = [refName(detail.ItemRef) ?? refName(detail.AccountRef), text(line.Description)].filter(Boolean).join(': ');
  const qty = num(detail.Qty);
  const unit = num(detail.UnitPrice);
  const each = qty !== undefined && unit !== undefined && qty !== 1 ? ` (${qty} × ${money(unit, undefined)})` : '';
  return `- ${what || 'Line'}${each}: ${money(num(line.Amount), currency)}`;
}

/**
 * The transactions a payment was applied to, by type and QuickBooks id, with
 * the document number when this run read that transaction.
 * @param row - A Payment or BillPayment.
 * @param docNumbers - `Invoice:<id>` / `Bill:<id>` to the number this run read.
 */
function appliedTo(row: QuickbooksRow, docNumbers: ReadonlyMap<string, string>): Array<{ type: string; id: string; docNumber?: string }> {
  const out: Array<{ type: string; id: string; docNumber?: string }> = [];
  for (const line of lines(row)) {
    for (const linked of Array.isArray(line.LinkedTxn) ? line.LinkedTxn : []) {
      const id = text((linked as { TxnId?: unknown }).TxnId);
      const type = text((linked as { TxnType?: unknown }).TxnType);
      if (id && type) {
        const docNumber = docNumbers.get(`${type}:${id}`);
        out.push({ type, id, ...(docNumber ? { docNumber } : {}) });
      }
    }
  }
  return out;
}

type Mapped = { title: string; body: string[]; metadata: Record<string, unknown> };

/**
 * An account: its number, name, type and balance.
 * @param row - The Account row.
 * @param updated - When QuickBooks last changed it, for the dated balance.
 */
function mapAccount(row: QuickbooksRow, updated: string | undefined): Mapped {
  const name = text(row.FullyQualifiedName) ?? text(row.Name) ?? `Account ${text(row.Id)}`;
  const number = text(row.AcctNum);
  const currency = refValue(row.CurrencyRef);
  const balance = num(row.CurrentBalance);
  const kind = [text(row.Classification), text(row.AccountType), text(row.AccountSubType)].filter(Boolean).join(' · ');
  return {
    title: `Account ${number ? `${number} ` : ''}${name}`,
    body: [
      `Account ${number ? `${number} ` : ''}${name}${kind ? ` (${kind})` : ''}`,
      `Balance ${money(balance, currency)}${updated ? ` as of ${updated}` : ''}`,
      row.Active === false ? 'Inactive.' : '',
      text(row.Description) ?? '',
    ],
    metadata: {
      name,
      accountNumber: number,
      accountType: text(row.AccountType),
      accountSubType: text(row.AccountSubType),
      classification: text(row.Classification),
      balance,
      currency,
      active: row.Active !== false,
    },
  };
}

/**
 * An invoice or a bill: party, dates, lines, total and what is still owed.
 * @param entity - Invoice or Bill.
 * @param row - The row.
 */
function mapInvoiceOrBill(entity: 'Invoice' | 'Bill', row: QuickbooksRow): Mapped {
  const isInvoice = entity === 'Invoice';
  const party = refName(isInvoice ? row.CustomerRef : row.VendorRef);
  const number = text(row.DocNumber);
  const currency = refValue(row.CurrencyRef);
  const total = num(row.TotalAmt);
  const balance = num(row.Balance);
  const status = settlement(total, balance);
  const due = text(row.DueDate);
  const itemLines = lines(row).map(line => itemLine(line, currency)).filter((line): line is string => line !== null);
  const label = isInvoice ? 'Invoice' : 'Bill';
  return {
    title: `${label}${number ? ` ${number}` : ''}${party ? ` · ${party}` : ''}`,
    body: [
      `${label}${number ? ` ${number}` : ''} ${isInvoice ? 'to' : 'from'} ${party ?? 'an unnamed party'}`,
      `Dated ${text(row.TxnDate) ?? 'unknown'}${due ? `, due ${due}` : ''}`,
      `Total ${money(total, currency)}; ${status === 'paid' ? 'paid in full' : `balance ${money(balance, currency)}${status ? ` (${status})` : ''}`}`,
      itemLines.length > 0 ? `Lines:\n${itemLines.join('\n')}` : '',
      text((row.CustomerMemo as { value?: unknown } | undefined)?.value) ? `Message: ${text((row.CustomerMemo as { value?: unknown }).value)}` : '',
      text(row.PrivateNote) ? `Note: ${text(row.PrivateNote)}` : '',
    ],
    metadata: {
      docNumber: number,
      txnDate: text(row.TxnDate),
      dueDate: due,
      [isInvoice ? 'customer' : 'vendor']: party,
      [isInvoice ? 'customerId' : 'vendorId']: refValue(isInvoice ? row.CustomerRef : row.VendorRef),
      total,
      balance,
      status,
      currency,
    },
  };
}

/**
 * A payment received or a bill payment made: who, when, how much, and what
 * it settled.
 * @param entity - Payment or BillPayment.
 * @param row - The row.
 * @param docNumbers - Invoice and bill numbers this run read, by type and id.
 */
function mapPayment(entity: 'Payment' | 'BillPayment', row: QuickbooksRow, docNumbers: ReadonlyMap<string, string>): Mapped {
  const received = entity === 'Payment';
  const party = refName(received ? row.CustomerRef : row.VendorRef);
  const currency = refValue(row.CurrencyRef);
  const total = num(row.TotalAmt);
  const date = text(row.TxnDate);
  const applied = appliedTo(row, docNumbers);
  const account = refName(row.DepositToAccountRef)
    ?? refName((row.CheckPayment as { BankAccountRef?: unknown } | undefined)?.BankAccountRef)
    ?? refName((row.CreditCardPayment as { CCAccountRef?: unknown } | undefined)?.CCAccountRef);
  const reference = text(row.PaymentRefNum) ?? text(row.DocNumber);
  const unapplied = num(row.UnappliedAmt);
  return {
    title: received
      ? `Payment from ${party ?? 'a customer'}${date ? ` · ${date}` : ''}`
      : `Bill payment to ${party ?? 'a vendor'}${date ? ` · ${date}` : ''}`,
    body: [
      `${received ? 'Payment received from' : 'Bill payment made to'} ${party ?? 'an unnamed party'} on ${date ?? 'an unknown date'}`,
      `Amount ${money(total, currency)}${reference ? `, reference ${reference}` : ''}${account ? `, ${received ? 'deposited to' : 'paid from'} ${account}` : ''}`,
      applied.length > 0 ? `Applied to: ${applied.map(link => (link.docNumber ? `${link.type} ${link.docNumber}` : `${link.type} (QuickBooks id ${link.id})`)).join(', ')}` : '',
      unapplied !== undefined && unapplied > 0 ? `Unapplied: ${money(unapplied, currency)}` : '',
      text(row.PrivateNote) ? `Note: ${text(row.PrivateNote)}` : '',
    ],
    metadata: {
      direction: received ? 'received' : 'paid',
      txnDate: date,
      [received ? 'customer' : 'vendor']: party,
      [received ? 'customerId' : 'vendorId']: refValue(received ? row.CustomerRef : row.VendorRef),
      total,
      currency,
      reference,
      account,
      appliedTo: applied,
    },
  };
}

/**
 * A journal entry: its debits and credits, account by account.
 * @param row - The JournalEntry row.
 */
function mapJournalEntry(row: QuickbooksRow): Mapped {
  const number = text(row.DocNumber);
  const date = text(row.TxnDate);
  const currency = refValue(row.CurrencyRef);
  let debits = 0;
  const postings = lines(row).map((line) => {
    const detail = (line.JournalEntryLineDetail ?? {}) as Record<string, unknown>;
    const posting = text(detail.PostingType) ?? 'Line';
    const amount = num(line.Amount);
    if (posting === 'Debit' && amount !== undefined) {
      debits += amount;
    }
    return `- ${posting} ${refName(detail.AccountRef) ?? 'an account'}: ${money(amount, currency)}${text(line.Description) ? ` (${text(line.Description)})` : ''}`;
  });
  const total = num(row.TotalAmt) ?? debits;
  return {
    title: `Journal entry${number ? ` ${number}` : ''}${date ? ` · ${date}` : ''}`,
    body: [
      `Journal entry${number ? ` ${number}` : ''} on ${date ?? 'an unknown date'}`,
      `Total ${money(total, currency)}`,
      text(row.PrivateNote) ? `Memo: ${text(row.PrivateNote)}` : '',
      postings.length > 0 ? `Postings:\n${postings.join('\n')}` : '',
    ],
    metadata: { docNumber: number, txnDate: date, total, currency },
  };
}

/**
 * One record as a document. Its text names the company and, for the sample,
 * says plainly that it is sample data.
 * @param input - The record and where it came from.
 * @param input.entity - Its QuickBooks entity.
 * @param input.row - The row.
 * @param input.reader - The company it was read from.
 * @param input.company - The company's name, for the text.
 * @param input.docNumbers - Invoice and bill numbers read so far this run, so a payment can name what it settled.
 */
export function quickbooksDoc(input: { entity: QuickbooksEntity; row: QuickbooksRow; reader: QuickbooksReader; company: string; docNumbers?: ReadonlyMap<string, string> }): IngestDoc | null {
  const { entity, row, reader } = input;
  const id = text(row.Id) ?? (typeof row.Id === 'number' ? String(row.Id) : undefined);
  if (!id) {
    return null;
  }
  const updated = text((row.MetaData as { LastUpdatedTime?: unknown } | undefined)?.LastUpdatedTime);
  const mapped = entity === 'Account'
    ? mapAccount(row, updated)
    : entity === 'Invoice' || entity === 'Bill'
      ? mapInvoiceOrBill(entity, row)
      : entity === 'Payment' || entity === 'BillPayment'
        ? mapPayment(entity, row, input.docNumbers ?? new Map())
        : mapJournalEntry(row);
  const objectType = OBJECT_TYPE[entity];
  const header = reader.sample
    ? `QuickBooks · ${input.company} · sample data, not real books`
    : `QuickBooks · ${input.company}`;
  const metadata: Record<string, unknown> = {
    objectType,
    quickbooksId: id,
    realmId: reader.realmId,
    company: input.company,
    lastUpdatedAt: updated,
    ...(reader.sample ? { sample: true } : {}),
  };
  for (const [key, value] of Object.entries(mapped.metadata)) {
    if (value !== undefined) {
      metadata[key] = value;
    }
  }
  return {
    externalId: `quickbooks:${reader.realmId}:${objectType}:${id}`,
    title: reader.sample ? `Sample · ${mapped.title}` : mapped.title,
    content: [header, ...mapped.body].filter(Boolean).join('\n'),
    ...(reader.appHost ? { uri: `${reader.appHost}${APP_PATH[entity](id)}` } : {}),
    lastModifiedAt: updated ? new Date(updated) : null,
    metadata,
  };
}

/**
 * The reader for a real company: the login's access token, refreshed and
 * saved first when it is expiring, on the host of the company's environment.
 * @param ctx - The sync context.
 * @param baseUrl - A configured API host, when the source names one.
 * @throws {Error} Error when there is no QuickBooks login to read with.
 */
async function liveReaderFor(ctx: SourceContext, baseUrl: string | undefined): Promise<{ reader: QuickbooksReader; company: string }> {
  const credentials = ctx.credentials;
  if (!isLoginGrant(credentials) || typeof credentials.realmId !== 'string' || !credentials.realmId) {
    throw new Error('QuickBooks needs a login: an admin logs in with QuickBooks on the Connectors page, once per company. To try the connector first, turn on sample data for this source.');
  }
  const grant = await usableLoginGrant({
    vendor: 'QuickBooks',
    provider: 'quickbooks',
    connectorSlug: 'quickbooks',
    grant: credentials,
    persistence: { kind: 'persist', orgId: ctx.orgId, sourceId: ctx.sourceId, warn: message => ctx.onProgress?.({ kind: 'error', message }) },
    refresh: refreshQuickbooksGrant,
  });
  const realmId = String(grant.realmId);
  const host = baseUrl ?? QUICKBOOKS_API_BASE[grant.environment === 'sandbox' ? 'sandbox' : 'production'];
  const company = text(grant.companyName) ?? `company ${realmId}`;
  return { reader: liveQuickbooksReader({ accessToken: grant.accessToken, realmId, baseUrl: host }), company };
}

export const quickbooksConnector: SourceConnector<typeof quickbooksConfigSchema> = {
  slug: 'quickbooks',
  name: 'QuickBooks Online',
  brand: 'quickbooks',
  description: 'Read a QuickBooks Online company — accounts, invoices, bills, payments and journal entries — read-only, incremental by last update. Turn on sample data to try it without a login.',
  icon: 'Landmark',
  authKind: 'oauth',
  configSchema: quickbooksConfigSchema,
  // Incremental syncs cannot see a deleted or merged record; a daily full
  // pass re-reads the books and prunes what is gone.
  defaultReconcileCron: '30 3 * * *',
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = quickbooksConfigSchema.parse(ctx.config);
    const { reader, company } = cfg.sample
      ? { reader: sampleQuickbooksReader(), company: SAMPLE_COMPANY_NAME }
      : await liveReaderFor(ctx, cfg.baseUrl);
    // Invoices and bills are read before payments, so a payment can name the
    // numbers it settled. An incremental run that did not re-read them falls
    // back to the QuickBooks id, which metadata carries either way.
    const docNumbers = new Map<string, string>();
    for (const entity of ENTITIES) {
      for (let start = 1; ; start += QUICKBOOKS_PAGE_SIZE) {
        let rows: QuickbooksRow[];
        try {
          rows = await reader.query(entity, { start, max: QUICKBOOKS_PAGE_SIZE, since: ctx.since });
        } catch (error) {
          // One entity the login may not read (a 403 on bills) should not cost
          // the others; a refused login or a rate limit ends the run.
          if (error instanceof QuickbooksQueryError && !error.fatal) {
            ctx.onProgress?.({ kind: 'error', message: error.message });
            break;
          }
          throw error;
        }
        for (const row of rows) {
          const doc = quickbooksDoc({ entity, row, reader, company, docNumbers });
          const number = text(row.DocNumber);
          if (doc && number && (entity === 'Invoice' || entity === 'Bill')) {
            docNumbers.set(`${entity}:${String(doc.metadata?.quickbooksId)}`, number);
          }
          if (doc) {
            ctx.onProgress?.({ kind: 'fetched', uri: doc.externalId });
            yield doc;
          }
        }
        if (rows.length < QUICKBOOKS_PAGE_SIZE) {
          break;
        }
      }
    }
  },
};
