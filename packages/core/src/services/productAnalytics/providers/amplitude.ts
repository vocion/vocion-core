/**
 * AMPLITUDE — a provider of the analytics family (`../provider.ts`).
 *
 * One client per call, built with the source's credential (the project's
 * API key and secret key, the `amplitude` platform) and its region, so a
 * rotated key takes effect on the next read and two workspaces never share
 * a client.
 *
 * Amplitude builds a funnel from any steps on the fly, so there are no saved
 * funnels to list here; a saved funnel id is answered with a sentence saying
 * to give the steps instead.
 */

import type { AnalyticsProvider, AnalyticsSeries } from '../provider';
import type { AmplitudeFetch } from '@/libs/amplitude/client';
import type { FamilySource } from '@/libs/connectors/families';
import { amplitudeCredentialsFrom, createAmplitudeClient } from '@/libs/amplitude/client';
import { amplitudeConfigSchema } from '@/libs/sources/amplitude';
import { familySourceCredentials, noCredentialMessage } from '@/services/connectors/familyCredentials';
import { funnelSteps } from './funnelSteps';

const INTERVAL = { day: 1, week: 7, month: 30 } as const;

/**
 * How the project is named to a person: Amplitude's key pair names no
 * project, so the API key's last four characters stand in (the API key is
 * public — it ships in the app's tracking code).
 * @param apiKey - The project's API key.
 */
function projectLabel(apiKey: string): string {
  return `project with API key …${apiKey.slice(-4)}`;
}

/**
 * The Amplitude provider for one source.
 * @param orgId - The workspace.
 * @param source - The `amplitude` source.
 * @param deps - Injected for tests.
 * @param deps.fetch - The network.
 * @param deps.sleep - The wait before a retry.
 */
export async function amplitudeAnalyticsProvider(orgId: string, source: FamilySource, deps: { fetch?: AmplitudeFetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<AnalyticsProvider> {
  const { region } = amplitudeConfigSchema.parse(source.config ?? {});
  const bag = await familySourceCredentials(orgId, source);
  if (!bag) {
    throw new Error(noCredentialMessage(source, 'Amplitude'));
  }
  const creds = amplitudeCredentialsFrom(bag);
  if (!creds.ok) {
    throw new Error(creds.message);
  }
  const client = createAmplitudeClient({ credentials: creds.credentials, region }, deps);

  return {
    kind: 'amplitude',
    sourceSlug: source.slug,
    vendor: 'Amplitude',
    project: projectLabel(creds.credentials.apiKey),
    projectUrl: null,
    async listEvents(limit) {
      // This week's totals, most used first.
      const events = await client.eventsList();
      return events
        .sort((a, b) => (b.totals ?? -1) - (a.totals ?? -1))
        .slice(0, limit)
        .map(e => ({ name: e.name, volume: e.totals }));
    },
    async eventCounts({ events, from, to, interval, measure }) {
      const out: AnalyticsSeries[] = [];
      for (const event of events) {
        const points = await client.segmentation({ event, from, to, interval: INTERVAL[interval], metric: measure === 'uniques' ? 'uniques' : 'totals' });
        out.push({ event, measure, interval, points, total: points.reduce((sum, p) => sum + p.value, 0) });
      }
      return out;
    },
    async savedFunnels() {
      return [];
    },
    async funnel({ steps, savedFunnelId, from, to, windowDays }) {
      if (!steps || steps.length < 2) {
        throw new Error(savedFunnelId
          ? 'Amplitude builds a funnel from its steps; it has no saved funnel to read by id. Give the steps, as event names in order.'
          : 'Give at least two steps, as event names in order.');
      }
      const result = await client.funnel({ steps, from, to, windowSeconds: windowDays * 86_400 });
      return { name: null, steps: funnelSteps(result.steps), from, to };
    },
    async cohorts() {
      return client.cohorts();
    },
  };
}
