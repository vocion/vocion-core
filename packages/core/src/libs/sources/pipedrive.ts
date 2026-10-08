/**
 * Pipedrive connector — organizations, people, deals, activities and notes,
 * synced as retrievable documents in the CRM family's one shape
 * (`libs/connectors/crmDoc.ts`).
 *
 * Auth: a personal API token (`libs/pipedrive/client.ts`). No OAuth app is
 * needed.
 *
 * Incremental: the v2 collections take `updated_since`, so an incremental
 * run reads only what changed; notes come newest-updated first and the walk
 * stops at the watermark. A full run reads every organization, person and
 * deal, and the activity and notes of the last `activityDays`. A deleted
 * record drops out of the next full run (daily), which retires its document.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { PdEnvelope, PdLookups, PdRow, PipedriveAuth } from '@/libs/pipedrive/client';
import type { CrmObject } from '@/services/crm/provider';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { crmActivityDoc, crmRecordDoc } from '@/libs/connectors/crmDoc';
import { loadPipedriveLookups, PD_COLLECTION, pdPages, pdRequest, pdTime, PIPEDRIVE_API, pipedriveAuthFrom, readPipedriveMe, toPipedriveActivity, toPipedriveNote, toPipedriveRecord } from '@/libs/pipedrive/client';
import { InspectInputError } from './inspect';

export const PIPEDRIVE_SYNC_OBJECTS = ['accounts', 'contacts', 'deals', 'activities'] as const;

const pipedriveConfigSchema = z.object({
  /** What to sync. Accounts are organizations; activities include notes. */
  objects: z.array(z.enum(PIPEDRIVE_SYNC_OBJECTS)).min(1).default([...PIPEDRIVE_SYNC_OBJECTS]),
  /** How far back a full sync reads activities and notes. */
  activityDays: z.number().int().positive().max(3650).default(90),
  /** Override for tests. */
  baseUrl: z.string().url().default(PIPEDRIVE_API),
});

/** Organizations first, so a person's or a deal's organization has a name. */
const RECORD_ORDER: ReadonlyArray<[(typeof PIPEDRIVE_SYNC_OBJECTS)[number], CrmObject]> = [['accounts', 'account'], ['contacts', 'contact'], ['deals', 'deal']];

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: whose token it is, and whether deals can be read.
 * Read-only; two requests.
 * @param auth - The token.
 */
export async function inspectPipedrive(auth: PipedriveAuth): Promise<ConnectorInspection> {
  const me = await readPipedriveMe(auth);
  if (!me.ok) {
    return { reachable: me.status !== null, authorized: false, checks: [check('token', 'Token accepted', false, me.message)], note: null, error: me.message };
  }
  const checks = [check('token', 'Token accepted', true, `${me.data.name ?? 'Someone'} (${me.data.email ?? 'no email'}) at ${me.data.company_name ?? me.data.company_domain ?? 'their company'}.`)];
  const deals = await pdRequest<PdEnvelope<unknown[]>>(auth, '/api/v2/deals', { query: { limit: 1 } });
  checks.push(check('deals', 'Reads deals', deals.ok, deals.ok ? null : deals.message));
  return { reachable: true, authorized: true, checks, note: 'The token acts as the person who made it and sees what they see. Nothing was saved by this test.', error: deals.ok ? null : deals.message };
}

export const pipedriveConnector: SourceConnector<typeof pipedriveConfigSchema> = {
  slug: 'pipedrive',
  name: 'Pipedrive',
  brand: 'pipedrive',
  description: 'Organizations, people, deals, activities and notes from Pipedrive, synced incrementally. Agents also read and update records live.',
  icon: 'Handshake',
  authKind: 'apikey',
  configSchema: pipedriveConfigSchema,
  defaultReconcileCron: '45 3 * * *',
  inspectNote: 'Reads whose token it is and one deal. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    const cfg = pipedriveConfigSchema.parse(config ?? {});
    const parsed = pipedriveAuthFrom(credentials, cfg.baseUrl);
    if (!parsed.ok) {
      throw new InspectInputError(parsed.message);
    }
    return inspectPipedrive(parsed.auth);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = pipedriveConfigSchema.parse(ctx.config);
    const parsed = pipedriveAuthFrom(ctx.credentials, cfg.baseUrl);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const auth = parsed.auth;
    const me = await readPipedriveMe(auth);
    if (!me.ok) {
      throw new Error(me.message);
    }
    const lookups: PdLookups = await loadPipedriveLookups(auth, me.data.company_domain ?? null);
    const updatedSince = ctx.since ? ctx.since.toISOString().replace(/\.\d{3}Z$/, 'Z') : undefined;

    for (const [wanted, object] of RECORD_ORDER) {
      if (!cfg.objects.includes(wanted)) {
        continue;
      }
      for await (const page of pdPages<PdRow>(auth, PD_COLLECTION[object], { updated_since: updatedSince })) {
        for (const row of page) {
          if (object === 'account' && typeof row.name === 'string') {
            lookups.orgs.set(row.id, row.name);
          }
          if (row.is_deleted === true) {
            continue;
          }
          ctx.onProgress?.({ kind: 'fetched', uri: `${object}:${row.id}` });
          yield crmRecordDoc('pipedrive', toPipedriveRecord(object, row, lookups));
        }
      }
    }

    if (cfg.objects.includes('activities')) {
      const cutoff = ctx.since ?? new Date(Date.now() - cfg.activityDays * 86_400_000);
      const since = cutoff.toISOString().replace(/\.\d{3}Z$/, 'Z');
      for await (const page of pdPages<PdRow>(auth, 'activities', { updated_since: since })) {
        for (const row of page) {
          if (row.is_deleted === true) {
            continue;
          }
          ctx.onProgress?.({ kind: 'fetched', uri: `activity:${row.id}` });
          yield crmActivityDoc('pipedrive', toPipedriveActivity(row, lookups));
        }
      }
      // Notes are v1: newest-updated first, so the walk stops at the cutoff.
      let start = 0;
      let more = true;
      while (more) {
        const res = await pdRequest<PdEnvelope<PdRow[]>>(auth, '/v1/notes', { query: { start, limit: 500, sort: 'update_time DESC' } });
        if (!res.ok) {
          throw new Error(res.message);
        }
        const notes = res.data?.data ?? [];
        for (const row of notes) {
          const stamp = pdTime(typeof row.update_time === 'string' ? row.update_time : null);
          const updated = stamp ? Date.parse(stamp) : Number.NaN;
          if (!Number.isNaN(updated) && updated < cutoff.getTime()) {
            more = false;
            break;
          }
          ctx.onProgress?.({ kind: 'fetched', uri: `note:${row.id}` });
          yield crmActivityDoc('pipedrive', toPipedriveNote(row));
        }
        const pagination = res.data?.additional_data?.pagination;
        if (more && pagination?.more_items_in_collection && typeof pagination.next_start === 'number') {
          start = pagination.next_start;
        } else {
          more = false;
        }
      }
    }
  },
};
