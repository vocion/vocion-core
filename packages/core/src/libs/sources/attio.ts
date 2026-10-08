/**
 * Attio connector — companies, people, deals and notes, synced as retrievable
 * documents in the CRM family's one shape (`libs/connectors/crmDoc.ts`).
 *
 * Auth: a workspace access token (`libs/attio/client.ts`). No OAuth app is
 * needed.
 *
 * Attio has no "changed since" filter on records, so every run reads every
 * company, person and deal; the content hash downstream keeps an unchanged
 * record from being embedded again, so a re-read costs requests, not money.
 * Notes are read whole and kept to the last `activityDays` (by when they were
 * written; on an incremental run, the ones written since the watermark). A
 * deleted record drops out of the next full run, which retires its document.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { AttioAuth, AttioNote } from '@/libs/attio/client';
import type { CrmObject } from '@/services/crm/provider';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { ATTIO_API, ATTIO_OBJECT, attioAuthFrom, attioRecordPages, attioRequest, loadAttioLookups, readAttioSelf, toAttioNote, toAttioRecord } from '@/libs/attio/client';
import { crmActivityDoc, crmRecordDoc } from '@/libs/connectors/crmDoc';
import { InspectInputError } from './inspect';

export const ATTIO_SYNC_OBJECTS = ['accounts', 'contacts', 'deals', 'activities'] as const;

const attioConfigSchema = z.object({
  /** What to sync. Accounts are companies, contacts are people; activities are notes. */
  objects: z.array(z.enum(ATTIO_SYNC_OBJECTS)).min(1).default([...ATTIO_SYNC_OBJECTS]),
  /** How far back a full sync keeps notes. */
  activityDays: z.number().int().positive().max(3650).default(90),
  /** Override for tests. */
  baseUrl: z.string().url().default(ATTIO_API),
});

/** Companies first, so a person's or a deal's company has a name. */
const RECORD_ORDER: ReadonlyArray<[(typeof ATTIO_SYNC_OBJECTS)[number], CrmObject]> = [['accounts', 'account'], ['contacts', 'contact'], ['deals', 'deal']];

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: which workspace the token is for, and whether companies
 * can be read. Read-only; two requests.
 * @param auth - The token.
 */
export async function inspectAttio(auth: AttioAuth): Promise<ConnectorInspection> {
  const self = await readAttioSelf(auth);
  if (!self.ok || self.data?.active === false) {
    const message = self.ok ? 'Attio says this token is no longer active. Make a new one under Workspace settings → Developers.' : self.message;
    return { reachable: !self.ok ? self.status !== null : true, authorized: false, checks: [check('token', 'Token accepted', false, message)], note: null, error: message };
  }
  const checks = [check('token', 'Token accepted', true, `Workspace ${self.data?.workspace_name ?? self.data?.workspace_slug ?? 'unnamed'}.`)];
  const companies = await attioRequest<{ data?: unknown[] }>(auth, '/objects/companies/records/query', { method: 'POST', json: { limit: 1 } });
  checks.push(check('companies', 'Reads companies', companies.ok, companies.ok ? null : companies.message));
  return { reachable: true, authorized: true, checks, note: 'Nothing was saved by this test.', error: companies.ok ? null : companies.message };
}

export const attioConnector: SourceConnector<typeof attioConfigSchema> = {
  slug: 'attio',
  name: 'Attio',
  brand: 'attio',
  description: 'Companies, people, deals and notes from Attio. Agents also read and update records live.',
  icon: 'Building2',
  authKind: 'apikey',
  configSchema: attioConfigSchema,
  defaultReconcileCron: '0 4 * * *',
  inspectNote: 'Reads which workspace the token is for and one company. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    const cfg = attioConfigSchema.parse(config ?? {});
    const parsed = attioAuthFrom(credentials, cfg.baseUrl);
    if (!parsed.ok) {
      throw new InspectInputError(parsed.message);
    }
    return inspectAttio(parsed.auth);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = attioConfigSchema.parse(ctx.config);
    const parsed = attioAuthFrom(ctx.credentials, cfg.baseUrl);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const auth = parsed.auth;
    const lookups = await loadAttioLookups(auth);

    for (const [wanted, object] of RECORD_ORDER) {
      if (!cfg.objects.includes(wanted)) {
        continue;
      }
      for await (const page of attioRecordPages(auth, ATTIO_OBJECT[object])) {
        for (const record of page) {
          const mapped = toAttioRecord(object, record, lookups);
          if (object === 'account') {
            lookups.companies.set(mapped.id, mapped.name);
          }
          ctx.onProgress?.({ kind: 'fetched', uri: `${object}:${mapped.id}` });
          yield crmRecordDoc('attio', mapped);
        }
      }
    }

    if (cfg.objects.includes('activities')) {
      const cutoff = (ctx.since ?? new Date(Date.now() - cfg.activityDays * 86_400_000)).getTime();
      const limit = 50;
      for (let offset = 0; ; offset += limit) {
        const res = await attioRequest<{ data?: AttioNote[] }>(auth, '/notes', { query: { limit, offset } });
        if (!res.ok) {
          throw new Error(res.message);
        }
        const notes = res.data?.data ?? [];
        for (const note of notes) {
          const written = note.created_at ? Date.parse(note.created_at) : Number.NaN;
          if (!note.id?.note_id || (!Number.isNaN(written) && written < cutoff)) {
            continue;
          }
          const activity = toAttioNote(note, lookups);
          if (activity.on && activity.on.object === 'account') {
            activity.on.name = lookups.companies.get(activity.on.id) ?? null;
          }
          ctx.onProgress?.({ kind: 'fetched', uri: `note:${activity.id}` });
          yield crmActivityDoc('attio', activity);
        }
        if (notes.length < limit) {
          break;
        }
      }
    }
  },
};
