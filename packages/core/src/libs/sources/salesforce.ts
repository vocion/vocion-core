/**
 * Salesforce connector — accounts, contacts, opportunities and the activity
 * logged on them (tasks and events), synced as retrievable documents, one
 * per record, in the CRM family's one shape (`libs/connectors/crmDoc.ts`).
 *
 * Auth: a "Connect with Salesforce" login, or a pasted client-credentials
 * app from the customer's own org (`libs/salesforce/client.ts`).
 *
 * Incremental: when `ctx.since` is set every query gains
 * `SystemModstamp >= since`, the indexed stamp Salesforce moves on any change
 * to a record; a full run reads every account, contact and opportunity, and
 * the activity of the last `activityDays`. Deleted records stop matching
 * an incremental query, so a daily full run reconciles them away. Pages of up
 * to 2,000 records follow `nextRecordsUrl`; each query is one API request per
 * page against the org's daily allowance.
 *
 * Reads live — search, a record whole, its activity, the open pipeline — and
 * the writes (`crm.update_record`, `crm.add_note`) are the CRM family's
 * (`services/crm/providers/salesforce.ts`).
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { SalesforceAuth, SfRow } from '@/libs/salesforce/client';
import type { CrmObject } from '@/services/crm/provider';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { isLoginGrant, renewedLoginNote, testConnectionPersistence } from '@/libs/connect/loginGrant';
import { crmActivityDoc, crmRecordDoc } from '@/libs/connectors/crmDoc';
import { EVENT_FIELDS, resolveSalesforceAuth, SALESFORCE_API_VERSION, SELECT_FIELDS, sfRequest, SOBJECT, soqlDateTime, soqlPages, TASK_FIELDS, toCrmActivity, toCrmRecord } from '@/libs/salesforce/client';
import { InspectInputError } from './inspect';

export const SALESFORCE_SYNC_OBJECTS = ['accounts', 'contacts', 'deals', 'activities'] as const;

const salesforceConfigSchema = z.object({
  /** What to sync. Deals are opportunities; activities are tasks and events. */
  objects: z.array(z.enum(SALESFORCE_SYNC_OBJECTS)).min(1).default([...SALESFORCE_SYNC_OBJECTS]),
  /** How far back a full sync reads tasks and events. */
  activityDays: z.number().int().positive().max(3650).default(90),
  /** The REST API version, e.g. v61.0. */
  apiVersion: z.string().regex(/^v\d{2,3}\.0$/).default(SALESFORCE_API_VERSION),
});

const OBJECT_OF: Record<Exclude<(typeof SALESFORCE_SYNC_OBJECTS)[number], 'activities'>, CrmObject> = { accounts: 'account', contacts: 'contact', deals: 'deal' };

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: the token is accepted, the org's API allowance today, and
 * whether accounts and opportunities can be read. Read-only and free of any
 * write; spends three of the org's daily API requests.
 * @param auth - Where and as whom.
 */
export async function inspectSalesforce(auth: SalesforceAuth): Promise<ConnectorInspection> {
  const checks: ConnectorCheck[] = [];
  const limits = await sfRequest<{ DailyApiRequests?: { Max?: number; Remaining?: number } }>(auth, '/limits');
  if (!limits.ok) {
    checks.push(check('token', 'Token accepted', false, limits.message));
    return { reachable: limits.status !== null, authorized: false, checks, note: null, error: limits.message };
  }
  const daily = limits.data?.DailyApiRequests;
  checks.push(check('token', 'Token accepted', true, `${new URL(auth.instanceUrl).hostname}${daily?.Max ? `: ${daily.Remaining ?? '?'} of ${daily.Max} API requests left today` : ''}`));
  for (const object of ['account', 'deal'] as const) {
    const res = await sfRequest<{ totalSize?: number }>(auth, `/query?q=${encodeURIComponent(`SELECT COUNT() FROM ${SOBJECT[object]}`)}`);
    checks.push(check(object, `Reads ${object === 'deal' ? 'opportunities' : 'accounts'}`, res.ok, res.ok ? `${res.data?.totalSize ?? 0} visible to this user` : res.message));
  }
  const failed = checks.filter(c => !c.ok);
  return {
    reachable: true,
    authorized: true,
    checks,
    note: 'Nothing was saved by this test.',
    error: failed.length > 0 ? failed.map(c => c.detail).filter(Boolean).join(' ') : null,
  };
}

/**
 * The WHERE clause of a sync query: the window and the watermark, either or both.
 * @param clauses - Conditions, falsy ones dropped.
 */
function where(...clauses: Array<string | false | null>): string {
  const kept = clauses.filter(Boolean);
  return kept.length > 0 ? ` WHERE ${kept.join(' AND ')}` : '';
}

export const salesforceConnector: SourceConnector<typeof salesforceConfigSchema> = {
  slug: 'salesforce',
  name: 'Salesforce',
  brand: 'salesforce',
  description: 'Accounts, contacts, opportunities and their logged activity from Salesforce, synced incrementally. Agents also read and update records live.',
  icon: 'Cloud',
  authKind: 'oauth',
  configSchema: salesforceConfigSchema,
  defaultReconcileCron: '30 3 * * *',
  inspectNote: 'Reads the org\'s API allowance and counts accounts and opportunities: three API requests, nothing written, nothing saved.',

  async inspect({ config, credentials, savedSource }) {
    const cfg = salesforceConfigSchema.parse(config ?? {});
    let auth: SalesforceAuth | null;
    try {
      auth = await resolveSalesforceAuth(credentials, testConnectionPersistence('salesforce', savedSource), cfg.apiVersion);
    } catch (error) {
      throw new InspectInputError(error instanceof Error ? error.message : 'The Salesforce credential could not be used.');
    }
    if (!auth) {
      throw new InspectInputError('Connect with Salesforce, or paste a client-credentials app: the My Domain URL, the consumer key and the consumer secret.');
    }
    const inspection = await inspectSalesforce(auth);
    const renewed = isLoginGrant(credentials) && auth.accessToken !== credentials.accessToken;
    return renewed ? { ...inspection, note: renewedLoginNote('Salesforce') } : inspection;
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = salesforceConfigSchema.parse(ctx.config);
    const auth = await resolveSalesforceAuth(ctx.credentials, {
      kind: 'persist',
      orgId: ctx.orgId,
      sourceId: ctx.sourceId,
      warn: message => ctx.onProgress?.({ kind: 'error', message }),
    }, cfg.apiVersion);
    if (!auth) {
      throw new Error('Salesforce connector needs a Salesforce login (Connect with Salesforce) or a pasted client-credentials app (My Domain URL, consumer key, consumer secret).');
    }
    const changed = ctx.since ? `SystemModstamp >= ${soqlDateTime(ctx.since)}` : null;

    for (const wanted of cfg.objects) {
      if (wanted === 'activities') {
        continue;
      }
      const object = OBJECT_OF[wanted];
      const soql = `SELECT ${SELECT_FIELDS[object].join(', ')} FROM ${SOBJECT[object]}${where(changed)}`;
      for await (const page of soqlPages<SfRow>(auth, soql)) {
        for (const row of page) {
          ctx.onProgress?.({ kind: 'fetched', uri: row.Id });
          yield crmRecordDoc('salesforce', toCrmRecord(object, row, auth.instanceUrl));
        }
      }
    }

    if (cfg.objects.includes('activities')) {
      const windowStart = soqlDateTime(new Date(Date.now() - cfg.activityDays * 86_400_000));
      const recent = `LastModifiedDate >= ${windowStart}`;
      for (const [sobject, fields] of [['Task', TASK_FIELDS], ['Event', EVENT_FIELDS]] as const) {
        const soql = `SELECT ${fields.join(', ')} FROM ${sobject}${where(recent, changed)}`;
        for await (const page of soqlPages<SfRow>(auth, soql)) {
          for (const row of page) {
            ctx.onProgress?.({ kind: 'fetched', uri: row.Id });
            yield crmActivityDoc('salesforce', toCrmActivity(sobject, row));
          }
        }
      }
    }
  },
};
