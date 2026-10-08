/**
 * Amplitude connector — the capability carrier for the analytics tools on
 * Amplitude, and nothing else.
 *
 * Read LIVE (`analytics_events`, `analytics_event_counts`, `analytics_funnel`,
 * `analytics_cohorts`) through Amplitude's Dashboard REST API, never
 * mirrored: no person, property or event payload is copied into Vocion.
 * Auth: the project's API key and secret key (`amplitude` platform).
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { AmplitudeFetch } from '@/libs/amplitude/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { amplitudeCredentialsFrom, AmplitudeError, amplitudeHost, createAmplitudeClient } from '@/libs/amplitude/client';
import { InspectInputError } from './inspect';

export const amplitudeConfigSchema = z.object({
  /** Where the project's data lives: Amplitude's US or EU residency. */
  region: z.enum(['us', 'eu']).default('us'),
});

/**
 * Test connection: one read of the project's event list, which proves the
 * key pair and the region together. Read-only. Nothing is saved.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.config - The source config (`region`).
 * @param input.credentials - The key pair.
 * @param doFetch - The network, injected in tests.
 */
export async function inspectAmplitude(input: { config: Record<string, unknown>; credentials: Record<string, unknown> }, doFetch?: AmplitudeFetch): Promise<ConnectorInspection> {
  const creds = amplitudeCredentialsFrom(input.credentials);
  if (!creds.ok) {
    throw new InspectInputError(creds.message);
  }
  const config = amplitudeConfigSchema.safeParse(input.config ?? {});
  if (!config.success) {
    throw new InspectInputError('The data residency is us or eu.');
  }
  const { region } = config.data;
  const client = createAmplitudeClient({ credentials: creds.credentials, region }, { fetch: doFetch });
  const label = `Reads the project (${amplitudeHost(region)})`;
  const checks: ConnectorCheck[] = [];
  try {
    const events = await client.eventsList();
    const top = [...events].sort((a, b) => (b.totals ?? -1) - (a.totals ?? -1)).slice(0, 5).map(e => e.name);
    checks.push({ key: 'project', label, ok: true, detail: events.length > 0 ? `${events.length} events tracked; busiest this week: ${top.join(', ')}.` : 'The project tracks no visible events yet.' });
    return { reachable: true, authorized: true, checks, note: 'Read-only. Nothing was saved by this test.', error: null };
  } catch (err) {
    const status = err instanceof AmplitudeError ? err.status : null;
    const message = err instanceof Error ? err.message : String(err);
    checks.push({ key: 'project', label, ok: false, detail: message });
    return { reachable: status !== null, authorized: status !== 401 && status !== 403 && status !== null, checks, note: null, error: message };
  }
}

export const amplitudeConnector: SourceConnector<typeof amplitudeConfigSchema> = {
  slug: 'amplitude',
  name: 'Amplitude',
  description: 'Product analytics from Amplitude, read live: the events a project tracks, their counts over time, funnels built from any steps, and cohorts. Nothing about a person is copied into Vocion.',
  icon: 'BarChart3',
  brand: 'amplitude',
  authKind: 'apikey',
  syncless: true,
  configSchema: amplitudeConfigSchema,
  inspectNote: 'Reads the project\'s event list once. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectAmplitude({ config, credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the analytics tools, never mirrored.
  },
};
