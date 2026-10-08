/**
 * MIXPANEL — a provider of the analytics family (`../provider.ts`).
 *
 * One client per call, built with the source's credential (the service
 * account the `mixpanel` platform holds) and its project and region, so a
 * rotated secret takes effect on the next read and two workspaces never
 * share a client.
 *
 * What Mixpanel's Query API cannot do, the provider says rather than fakes:
 * a funnel is read from a SAVED funnel by id (the API builds none from
 * steps), and unique people are counted per day or per month (its
 * segmentation has no week; weekly totals are the days summed, and weekly
 * uniques cannot be).
 */

import type { AnalyticsInterval, AnalyticsProvider, AnalyticsSeries } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { MixpanelFetch } from '@/libs/mixpanel/client';
import { createMixpanelClient, mixpanelCredentialsFrom, mixpanelProjectUrl } from '@/libs/mixpanel/client';
import { mixpanelConfigSchema } from '@/libs/sources/mixpanel';
import { familySourceCredentials, noCredentialMessage } from '@/services/connectors/familyCredentials';
import { funnelSteps } from './funnelSteps';

/**
 * The Monday a day's week starts on, YYYY-MM-DD.
 * @param day - YYYY-MM-DD.
 */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Daily points summed into the weeks they fall in, each dated its Monday.
 * @param points - Daily points, in order.
 */
export function sumByWeek(points: ReadonlyArray<{ date: string; value: number }>): Array<{ date: string; value: number }> {
  const weeks = new Map<string, number>();
  for (const p of points) {
    const week = weekStart(p.date);
    weeks.set(week, (weeks.get(week) ?? 0) + p.value);
  }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

/**
 * The Mixpanel provider for one source.
 * @param orgId - The workspace.
 * @param source - The `mixpanel` source.
 * @param deps - Injected for tests.
 * @param deps.fetch - The network.
 * @param deps.sleep - The wait before a retry.
 */
export async function mixpanelAnalyticsProvider(orgId: string, source: FamilySource, deps: { fetch?: MixpanelFetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<AnalyticsProvider> {
  const parsed = mixpanelConfigSchema.safeParse(source.config);
  if (!parsed.success) {
    throw new Error(`The ${source.slug} source needs a numeric Mixpanel project id. Set it on the source.`);
  }
  const { projectId, region } = parsed.data;
  const bag = await familySourceCredentials(orgId, source);
  if (!bag) {
    throw new Error(noCredentialMessage(source, 'Mixpanel'));
  }
  const creds = mixpanelCredentialsFrom(bag);
  if (!creds.ok) {
    throw new Error(creds.message);
  }
  const client = createMixpanelClient({ credentials: creds.credentials, projectId, region }, deps);

  async function series(event: string, from: string, to: string, interval: AnalyticsInterval, measure: 'total' | 'uniques'): Promise<AnalyticsSeries> {
    if (interval === 'week' && measure === 'uniques') {
      throw new Error('Mixpanel counts unique people per day or per month, not per week. Ask for interval day or month.');
    }
    const daily = await client.segmentation({ event, from, to, unit: interval === 'month' ? 'month' : 'day', type: measure === 'uniques' ? 'unique' : 'general' });
    const points = interval === 'week' ? sumByWeek(daily) : daily;
    return { event, measure, interval, points, total: points.reduce((sum, p) => sum + p.value, 0) };
  }

  return {
    kind: 'mixpanel',
    sourceSlug: source.slug,
    vendor: 'Mixpanel',
    project: projectId,
    projectUrl: mixpanelProjectUrl(region, projectId),
    async listEvents(limit) {
      // Mixpanel's top events of the last 31 days, names only: the endpoint
      // carries no volume, and a count per event would spend the hour's quota.
      const names = await client.eventNames(limit);
      return names.slice(0, limit).map(name => ({ name, volume: null }));
    },
    async eventCounts({ events, from, to, interval, measure }) {
      const out: AnalyticsSeries[] = [];
      for (const event of events) {
        out.push(await series(event, from, to, interval, measure));
      }
      return out;
    },
    async savedFunnels() {
      return client.funnelsList();
    },
    async funnel({ steps, savedFunnelId, from, to, windowDays }) {
      if (!savedFunnelId) {
        const saved = await client.funnelsList();
        const names = saved.map(f => `${f.name} (${f.id})`).join(', ');
        throw new Error(`Mixpanel's API reads saved funnels only; it cannot build one from steps${steps?.length ? ` (${steps.join(' → ')})` : ''}. ${saved.length > 0 ? `Saved funnels: ${names}. Name one by its id.` : 'This project has no saved funnel: save one in Mixpanel first.'}`);
      }
      const saved = await client.funnelsList().catch(() => []);
      const result = await client.funnel({ funnelId: savedFunnelId, from, to, lengthDays: windowDays });
      if (result.steps.length === 0) {
        throw new Error(`Mixpanel returned no steps for funnel ${savedFunnelId} between ${from} and ${to}. Check the id against the saved funnels.`);
      }
      return { name: saved.find(f => f.id === savedFunnelId)?.name ?? null, steps: funnelSteps(result.steps), from, to };
    },
    async cohorts() {
      const rows = await client.cohorts();
      return rows.map(r => ({ id: r.id, name: r.name, description: r.description, size: r.count, updated: r.created }));
    },
  };
}
