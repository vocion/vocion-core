/**
 * Vonage connector — the account's voice calls as searchable documents (who called whom, when,
 * how long, how it ended, what it cost), read through the Reports API with the API key and
 * secret, the same credential the Vonage text surface (`libs/surfaces/vonage.ts`) spends.
 *
 * What it does not do, and why: placing a call and reading a recording need a Vonage
 * Application (an application id and a private key, signed into a JWT), which an API key and
 * secret cannot stand in for. Those wait for the workspace that needs them.
 *
 * Incremental: a run with a watermark asks the Reports API for calls from the watermark on. A
 * full run (the weekly reconcile) re-reads the window, so a record gone from Vonage is tombstoned.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { VonageCall } from '@/libs/vonage/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { listVonageCalls, readVonageBalance, vonageCredentialsFrom } from '@/libs/vonage/client';
import { InspectInputError } from './inspect';

const vonageConfigSchema = z.object({
  /** How far back a full run reads. */
  pastDays: z.number().int().positive().max(395).default(30),
});

/**
 * A call as the words a reader searches.
 * @param call - The call record.
 */
export function vonageCallDocument(call: VonageCall): string {
  return [
    `Call ${call.direction} from ${call.from ?? 'unknown'} to ${call.to ?? 'unknown'}`,
    `Started ${call.startTime ?? 'unknown'}; ${call.durationSeconds !== null ? `${call.durationSeconds} seconds` : 'duration unknown'}; status ${call.status ?? 'unknown'}${call.price ? `; cost ${call.price}` : ''}.`,
  ].join('\n');
}

/**
 * Every call in scope, as documents.
 * @param ctx - The run.
 * @param fetchImpl - Injectable for tests.
 * @yields Each document in scope.
 */
export async function* syncVonage(ctx: SourceContext, fetchImpl: typeof fetch = fetch): AsyncIterable<IngestDoc> {
  const creds = vonageCredentialsFrom(ctx.credentials);
  if (!creds) {
    throw new Error('No Vonage account. Connect Vonage with the API key and secret from the dashboard\'s API settings.');
  }
  const config = vonageConfigSchema.parse(ctx.config ?? {});
  const floor = new Date(Date.now() - config.pastDays * 86_400_000);
  const since = ctx.since && ctx.since > floor ? ctx.since : floor;
  const calls = await listVonageCalls(creds, { since }, fetchImpl);
  if (!calls.ok) {
    throw new Error(calls.message);
  }
  for (const call of calls.data) {
    ctx.onProgress?.({ kind: 'fetched', uri: `vonage:${call.id}` });
    yield {
      externalId: `vonage:call:${call.id}`,
      title: `Call ${call.from ?? '?'} → ${call.to ?? '?'} · ${call.startTime?.slice(0, 16).replace('T', ' ') ?? call.id}`,
      content: vonageCallDocument(call),
      etag: `${call.status}:${call.durationSeconds}`,
      lastModifiedAt: call.endTime ? new Date(call.endTime) : call.startTime ? new Date(call.startTime) : null,
      metadata: { callId: call.id, from: call.from, to: call.to, direction: call.direction, status: call.status, durationSeconds: call.durationSeconds },
    };
  }
}

/**
 * Test connection: the balance (the key and secret work), then the last week of calls.
 * @param input - The credential as typed or as vaulted.
 * @param input.credentials - The credential values.
 * @param fetchImpl - Injectable for tests.
 */
export async function inspectVonage(input: { credentials: Record<string, unknown> }, fetchImpl: typeof fetch = fetch): Promise<ConnectorInspection> {
  const creds = vonageCredentialsFrom(input.credentials);
  if (!creds) {
    throw new InspectInputError('No Vonage account. Paste the API key and secret from the dashboard\'s API settings.');
  }
  const checks: ConnectorCheck[] = [];
  const balance = await readVonageBalance(creds, fetchImpl);
  checks.push({ key: 'account', label: 'Reads the account', ok: balance.ok, detail: balance.ok ? (balance.data.value !== null ? `Balance ${balance.data.value.toFixed(2)}` : null) : balance.message });
  if (!balance.ok) {
    return { reachable: balance.status !== null, authorized: balance.status !== 401, checks, note: null, error: balance.message };
  }
  const calls = await listVonageCalls(creds, { since: new Date(Date.now() - 7 * 86_400_000) }, fetchImpl);
  checks.push({ key: 'calls', label: 'Reads the voice call log', ok: calls.ok, detail: calls.ok ? `${calls.data.length} call${calls.data.length === 1 ? '' : 's'} in the last 7 days` : calls.message });
  checks.push({ key: 'signature', label: 'Can check inbound texts', ok: Boolean(creds.signatureSecret), detail: creds.signatureSecret ? `Signed webhooks, ${creds.signatureMethod}` : 'Add the signature secret (API settings → Signed webhooks) so Vocion can answer texts to your Vonage numbers.' });
  const failed = checks.filter(c => !c.ok && c.key === 'calls');
  return { reachable: true, authorized: true, checks, note: 'Read-only: a test sends nothing.', error: failed.length > 0 ? failed.map(c => c.detail).join(' ') : null };
}

export const vonageConnector: SourceConnector<typeof vonageConfigSchema> = {
  slug: 'vonage',
  name: 'Vonage',
  description: 'Your Vonage voice call log, searchable and cited, on the same API key your Vonage numbers text with.',
  icon: 'Phone',
  authKind: 'apikey',
  configSchema: vonageConfigSchema,
  defaultReconcileCron: '45 4 * * 0',
  inspectNote: 'Reads the balance and the last week of calls. Nothing is sent.',
  async inspect({ credentials }) {
    return inspectVonage({ credentials });
  },
  sync: ctx => syncVonage(ctx),
};
