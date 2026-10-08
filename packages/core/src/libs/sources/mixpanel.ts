/**
 * Mixpanel connector — the capability carrier for the analytics tools on
 * Mixpanel, and nothing else.
 *
 * Product analytics is read LIVE (`analytics_events`, `analytics_event_counts`,
 * `analytics_funnel`, `analytics_cohorts`) through Mixpanel's Query API, never
 * mirrored: no person, property or event payload is copied into Vocion.
 * Auth: a service account (`mixpanel` platform); the project and its data
 * region are the source's.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { MixpanelFetch } from '@/libs/mixpanel/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { createMixpanelClient, mixpanelCredentialsFrom, MixpanelError, mixpanelHost } from '@/libs/mixpanel/client';
import { InspectInputError } from './inspect';

export const mixpanelConfigSchema = z.object({
  /** The project to read — the number in the project's URL. */
  projectId: z.union([z.string().regex(/^\d+$/), z.number().int().positive().transform(String)]),
  /** Where the project's data lives: Mixpanel's US, EU or India residency. */
  region: z.enum(['us', 'eu', 'in']).default('us'),
});

/**
 * Test connection: one read of the project's top event names, which proves
 * the service account, the project id and the region together. Read-only,
 * one query of the project's 60 an hour. Nothing is saved.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.config - The source config (`projectId`, `region`).
 * @param input.credentials - The service account.
 * @param doFetch - The network, injected in tests.
 */
export async function inspectMixpanel(input: { config: Record<string, unknown>; credentials: Record<string, unknown> }, doFetch?: MixpanelFetch): Promise<ConnectorInspection> {
  const creds = mixpanelCredentialsFrom(input.credentials);
  if (!creds.ok) {
    throw new InspectInputError(creds.message);
  }
  const config = mixpanelConfigSchema.safeParse(input.config);
  if (!config.success) {
    throw new InspectInputError('Enter the Mixpanel project id: the number in the project\'s URL, after /project/.');
  }
  const { projectId, region } = config.data;
  const client = createMixpanelClient({ credentials: creds.credentials, projectId, region }, { fetch: doFetch });
  const checks: ConnectorCheck[] = [];
  try {
    const names = await client.eventNames(5);
    checks.push({ key: 'project', label: `Reads project ${projectId} (${mixpanelHost(region)})`, ok: true, detail: names.length > 0 ? `Top events: ${names.join(', ')}.` : 'The project tracked no events in the last 31 days.' });
    return { reachable: true, authorized: true, checks, note: 'Read-only. Nothing was saved by this test.', error: null };
  } catch (err) {
    const status = err instanceof MixpanelError ? err.status : null;
    const message = err instanceof Error ? err.message : String(err);
    checks.push({ key: 'project', label: `Reads project ${projectId} (${mixpanelHost(region)})`, ok: false, detail: message });
    return { reachable: status !== null, authorized: status !== 401 && status !== 403 && status !== null, checks, note: null, error: message };
  }
}

export const mixpanelConnector: SourceConnector<typeof mixpanelConfigSchema> = {
  slug: 'mixpanel',
  name: 'Mixpanel',
  description: 'Product analytics from Mixpanel, read live: the events a project tracks, their counts over time, saved funnels and cohorts. Nothing about a person is copied into Vocion.',
  icon: 'BarChart3',
  brand: 'mixpanel',
  authKind: 'apikey',
  syncless: true,
  configSchema: mixpanelConfigSchema,
  inspectNote: 'Reads the project\'s top event names once: read-only, one of the project\'s 60 queries an hour. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectMixpanel({ config, credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the analytics tools, never mirrored.
  },
};
