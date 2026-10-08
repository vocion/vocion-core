/**
 * THE ANALYTICS FAMILY — product analytics as an agent reads it.
 *
 * "How many people sent a document last week", "where do signups drop off",
 * "which cohorts exist" are the same questions on Mixpanel and on Amplitude,
 * so the agent has one set of tools (`analytics_events`,
 * `analytics_event_counts`, `analytics_funnel`, `analytics_cohorts`) and this
 * interface is what each vendor fills in. The source a workspace connected
 * decides which provider answers; the agent never names a vendor.
 *
 * Read-only: no provider writes to the vendor. Every number comes back with
 * the date range it covers, so an answer can say what it counted.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { familySourcesForOrg } from '@/libs/connectors/families';

/** How a count is taken: every occurrence, or each person once per interval. */
export type AnalyticsMeasure = 'total' | 'uniques';
export type AnalyticsInterval = 'day' | 'week' | 'month';

/** One event the project tracks. */
export type AnalyticsEvent = {
  name: string;
  /** How often it happened recently, when the vendor says cheaply; null otherwise. */
  volume: number | null;
};

/** One event's counts over a range. */
export type AnalyticsSeries = {
  event: string;
  measure: AnalyticsMeasure;
  interval: AnalyticsInterval;
  /** One point per interval, its date the interval's first day (YYYY-MM-DD). */
  points: Array<{ date: string; value: number }>;
  /** The points summed. For `uniques` that is person-intervals, not people. */
  total: number;
};

export type AnalyticsFunnelStep = {
  event: string;
  /** People who reached this step. */
  count: number;
  /** Share of the previous step's people who reached this one, 0–1; null on the first step. */
  fromPrevious: number | null;
  /** Share of the first step's people who reached this one, 0–1. */
  fromStart: number;
};

export type AnalyticsFunnel = {
  /** The saved funnel's name, when one was read. */
  name: string | null;
  steps: AnalyticsFunnelStep[];
  from: string;
  to: string;
};

export type AnalyticsCohort = {
  id: string;
  name: string;
  description: string | null;
  /** People in it, when the vendor says. */
  size: number | null;
  /** When it was last computed or edited, ISO, when the vendor says. */
  updated: string | null;
};

export type AnalyticsRange = { from: string; to: string };

export type AnalyticsProvider = {
  /** The connector kind behind this provider (`mixpanel`). */
  kind: string;
  /** The source slug it answers for. */
  sourceSlug: string;
  /** The vendor, as a person knows it: "Mixpanel". */
  vendor: string;
  /** The project read, as the vendor names it (its id). */
  project: string;
  /** The project in the vendor's own app, when there is a stable link. */
  projectUrl: string | null;
  /** The events the project tracks, most used first where the vendor says. */
  listEvents: (limit: number) => Promise<AnalyticsEvent[]>;
  /** Counts per interval for each event. */
  eventCounts: (input: AnalyticsRange & { events: string[]; interval: AnalyticsInterval; measure: AnalyticsMeasure }) => Promise<AnalyticsSeries[]>;
  /**
   * The saved funnels, for a vendor whose API reads funnels by id (Mixpanel).
   * Empty for one that builds a funnel from steps on the fly.
   */
  savedFunnels: () => Promise<Array<{ id: string; name: string }>>;
  /**
   * Conversion through steps in order, within `windowDays` of the first:
   * from `steps` on a vendor that builds funnels on the fly, from
   * `savedFunnelId` on one that reads saved funnels. Either refusal is a
   * sentence naming what the vendor can do instead.
   */
  funnel: (input: AnalyticsRange & { steps?: string[]; savedFunnelId?: string; windowDays: number }) => Promise<AnalyticsFunnel>;
  /** The project's saved cohorts. */
  cohorts: () => Promise<AnalyticsCohort[]>;
};

/**
 * The provider for an analytics source, or the agent's only one.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - The source to use, when the caller names one.
 * @param opts.slugs - Only these sources: the agent's own, narrowed by the person's ACL.
 */
export async function analyticsProviderFor(orgId: string, opts: { sourceSlug?: string | null; slugs?: readonly string[] } = {}): Promise<AnalyticsProvider> {
  const sources = await familySourcesForOrg(orgId, 'analytics', opts.slugs);
  if (sources.length === 0) {
    throw new Error('No product analytics is connected for this agent. Connect one (Mixpanel or Amplitude) at /dashboard/connectors and give this agent the source.');
  }
  let chosen: FamilySource | undefined;
  if (opts.sourceSlug) {
    chosen = sources.find(s => s.slug === opts.sourceSlug);
    if (!chosen) {
      throw new Error(`No analytics source named ${opts.sourceSlug}. Connected: ${sources.map(s => `${s.slug} (${s.kind})`).join(', ')}.`);
    }
  } else if (sources.length > 1) {
    throw new Error(`This agent reads ${sources.length} analytics sources; name one (source). Connected: ${sources.map(s => `${s.slug} (${s.kind})`).join(', ')}.`);
  } else {
    chosen = sources[0]!;
  }
  switch (chosen.kind) {
    case 'mixpanel':
      return (await import('./providers/mixpanel')).mixpanelAnalyticsProvider(orgId, chosen);
    case 'amplitude':
      return (await import('./providers/amplitude')).amplitudeAnalyticsProvider(orgId, chosen);
    default:
      throw new Error(`${chosen.slug} is a ${chosen.kind} source, which no analytics provider serves yet.`);
  }
}
