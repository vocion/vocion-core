/**
 * PagerDuty connector — the capability carrier for the incident reads and the
 * acknowledge action, and nothing else.
 *
 * Incidents are read LIVE, the way Sentry's issues are: whoever is on call
 * asks what is firing now, and a mirror of incidents would be stale the moment
 * it was written. So this connector ingests nothing (`syncless`); registering
 * it buys the PagerDuty tile on Connections, a place in the vault, and a Test
 * connection that says whether the key reads services and incidents.
 *
 * Auth: a REST API key as `Authorization: Token token=<key>`, API version 2
 * in `Accept`. A write made with an account-level key must name the PagerDuty
 * user it is made as in a `From` header — the credential's `fromEmail`.
 * EU accounts live on `api.eu.pagerduty.com`; the source names the host.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { VendorResult } from '@/libs/connectors/vendorRequest';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { vendorRequest } from '@/libs/connectors/vendorRequest';
import { InspectInputError } from './inspect';

export const PAGERDUTY_HOSTS = { us: 'https://api.pagerduty.com', eu: 'https://api.eu.pagerduty.com' } as const;

const pagerdutyConfigSchema = z.object({
  /** Where the account's data lives. */
  region: z.enum(['us', 'eu']).default('us'),
  /** Service ids Test connection confirms the key can see. Blank: every service it sees. */
  services: z.array(z.string().trim().min(1)).optional(),
});

/** A key, the host it is spent against, and the user writes are made as. */
export type PagerdutyAccess = { token: string; host: string; fromEmail: string | null };

/**
 * The vaulted key, or why there is none.
 * @param values - The decrypted credential bag.
 * @param region - The region the source names.
 */
export function pagerdutyAccessFrom(values: Record<string, unknown> | null | undefined, region: unknown): { ok: true; access: PagerdutyAccess } | { ok: false; message: string } {
  const token = typeof values?.token === 'string' ? values.token.trim() : '';
  if (!token) {
    return { ok: false, message: 'No PagerDuty API key is stored. Connect PagerDuty on the Connectors page with a REST API key.' };
  }
  const fromEmail = typeof values?.fromEmail === 'string' && values.fromEmail.trim() ? values.fromEmail.trim() : null;
  return { ok: true, access: { token, host: region === 'eu' ? PAGERDUTY_HOSTS.eu : PAGERDUTY_HOSTS.us, fromEmail } };
}

/**
 * One call to the PagerDuty REST API.
 * @param a - The key, host and acting user.
 * @param path - The path, from the host.
 * @param init - Method and JSON body.
 * @param init.method - The HTTP method.
 * @param init.json - The body.
 */
export function pagerdutyApi<T>(a: PagerdutyAccess, path: string, init: { method?: string; json?: unknown } = {}): Promise<VendorResult<T>> {
  return vendorRequest<T>({
    vendor: 'PagerDuty',
    url: `${a.host}${path}`,
    method: init.method,
    json: init.json,
    headers: {
      authorization: `Token token=${a.token}`,
      accept: 'application/vnd.pagerduty+json;version=2',
      ...(init.method && init.method !== 'GET' && a.fromEmail ? { from: a.fromEmail } : {}),
    },
    authHint: 'Check the REST API key (Integrations → API Access Keys), and that a write uses a full-access key with the email of a PagerDuty user.',
  });
}

/**
 * Test connection: the services the key sees, and one read of incidents.
 * Read-only.
 * @param config - The source config (`region`, `services`).
 * @param values - The credential values.
 */
export async function inspectPagerduty(config: Record<string, unknown>, values: Record<string, unknown>): Promise<ConnectorInspection> {
  const parsed = pagerdutyAccessFrom(values, config.region);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const a = parsed.access;
  const services = await pagerdutyApi<{ services?: Array<{ id: string; name: string }> }>(a, '/services?limit=100');
  if (!services.ok) {
    return { reachable: services.kind !== 'unreachable', authorized: false, checks: [{ key: 'services', label: 'Lists services', ok: false, detail: services.message }], note: null, error: services.message };
  }
  const seen = services.data.services ?? [];
  const checks: ConnectorCheck[] = [{ key: 'services', label: 'Lists services', ok: true, detail: seen.length > 0 ? seen.slice(0, 10).map(s => s.name).join(', ') : 'The key sees no service.' }];
  const wanted = Array.isArray(config.services) ? (config.services as unknown[]).map(String).filter(Boolean) : [];
  for (const id of wanted) {
    const hit = seen.find(s => s.id === id);
    checks.push({ key: `service:${id}`, label: `Sees service ${id}`, ok: Boolean(hit), detail: hit ? hit.name : 'Not among the first 100 services this key sees.' });
  }
  const incidents = await pagerdutyApi<{ incidents?: Array<{ incident_number?: number; title?: string }> }>(a, '/incidents?limit=1');
  checks.push({ key: 'incidents', label: 'Reads incidents', ok: incidents.ok, detail: incidents.ok ? (incidents.data.incidents?.[0] ? `Latest open: #${incidents.data.incidents[0].incident_number} ${incidents.data.incidents[0].title ?? ''}`.trim() : 'No open incident right now.') : incidents.message });
  checks.push({ key: 'acknowledge', label: 'Can acknowledge as a user', ok: true, detail: a.fromEmail ? `Acknowledgements are recorded as ${a.fromEmail}.` : 'No user email stored: reads work; acknowledging needs a full-access key and the email of a PagerDuty user.' });
  const failed = checks.filter(c => !c.ok);
  return { reachable: true, authorized: true, checks, note: null, error: failed.length > 0 ? failed.map(c => c.detail).join(' ') : null };
}

export const pagerdutyConnector: SourceConnector<typeof pagerdutyConfigSchema> = {
  slug: 'pagerduty',
  brand: 'pagerduty',
  name: 'PagerDuty',
  description: 'Incidents, read live: what is triggered or acknowledged, on which service, who is on it, and its timeline and notes. Agents can acknowledge an incident through the review queue.',
  icon: 'Megaphone',
  authKind: 'apikey',
  syncless: true,
  configSchema: pagerdutyConfigSchema,
  inspectNote: 'Lists the services the key sees and reads one incident. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectPagerduty(config, credentials);
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Incidents are read live by the incident tools, never mirrored.
  },
};
