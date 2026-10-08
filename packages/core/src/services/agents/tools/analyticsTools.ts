/**
 * The analytics family's reads — product analytics (Mixpanel, Amplitude),
 * read live, in one shape whichever vendor answers.
 *
 *   analytics_events        the events the project tracks.
 *   analytics_event_counts  counts per day, week or month for named events.
 *   analytics_funnel        conversion through steps in order.
 *   analytics_cohorts       the project's saved cohorts.
 *
 * Present for any agent whose `connectorSources` include an analytics source
 * (`familyInScope`), and only over those sources. The provider is the
 * source's (`services/productAnalytics/provider.ts`). Read-only: nothing here
 * changes the vendor's project.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { rangeFrom } from '@/libs/connectors/dateRange';
import { familyInScope, familySourceSlugs } from '@/libs/connectors/families';

export const ANALYTICS_EVENTS_TOOL = 'analytics_events';
export const ANALYTICS_EVENT_COUNTS_TOOL = 'analytics_event_counts';
export const ANALYTICS_FUNNEL_TOOL = 'analytics_funnel';
export const ANALYTICS_COHORTS_TOOL = 'analytics_cohorts';

export function analyticsTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'analytics')) {
    return [];
  }
  return [eventsTool(ctx), countsTool(ctx), funnelTool(ctx), cohortsTool(ctx)];
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sourceArg = z.string().optional().describe('The analytics source, when this agent reads more than one.');

async function provider(ctx: RuntimeContext, source: string | undefined) {
  const { analyticsProviderFor } = await import('@/services/productAnalytics/provider');
  return analyticsProviderFor(ctx.orgId, { sourceSlug: source ?? null, slugs: familySourceSlugs(ctx, 'analytics') });
}

function failure(err: unknown): string {
  return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
}

function eventsTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const p = await provider(ctx, args.source);
        const events = await p.listEvents(args.limit ?? 100);
        return JSON.stringify({ ok: true, analytics: p.vendor, source: p.sourceSlug, project: p.project, link: p.projectUrl, count: events.length, events, note: events.length === 0 ? 'The project tracks no events yet.' : 'Use the names exactly as written here in analytics_event_counts and analytics_funnel.' });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: ANALYTICS_EVENTS_TOOL,
      description: 'The events the connected product analytics project (Mixpanel or Amplitude) tracks, by their exact names, with recent volume where the vendor gives it. Use it first, so counts and funnels name events that exist.',
      schema: z.object({
        limit: z.number().int().min(1).max(1000).optional().describe('How many (default 100).'),
        source: sourceArg,
      }),
    },
  );
}

function countsTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const range = rangeFrom(args);
        const p = await provider(ctx, args.source);
        const series = await p.eventCounts({ ...range, events: args.events, interval: args.interval ?? 'day', measure: args.measure ?? 'total' });
        return JSON.stringify({ ok: true, analytics: p.vendor, source: p.sourceSlug, project: p.project, link: p.projectUrl, ...range, series, note: (args.measure ?? 'total') === 'uniques' ? 'Uniques are counted per interval: someone active in three intervals is three in the total.' : `Counts from ${range.from} to ${range.to}, inclusive, in the project's timezone.` });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: ANALYTICS_EVENT_COUNTS_TOOL,
      description: 'How often named events happened in the connected product analytics project (Mixpanel or Amplitude), per day, week or month, as total occurrences or unique people. Defaults to the last 30 days, ending yesterday.',
      schema: z.object({
        events: z.array(z.string().min(1).max(300)).min(1).max(10).describe('Event names exactly as analytics_events lists them.'),
        from: day.optional().describe('First day, YYYY-MM-DD (default 30 days before to).'),
        to: day.optional().describe('Last day, YYYY-MM-DD, inclusive (default yesterday).'),
        interval: z.enum(['day', 'week', 'month']).optional().describe('Default day.'),
        measure: z.enum(['total', 'uniques']).optional().describe('total occurrences (default) or unique people per interval.'),
        source: sourceArg,
      }),
    },
  );
}

function funnelTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const range = rangeFrom(args);
        const p = await provider(ctx, args.source);
        if (!args.steps?.length && !args.saved_funnel_id) {
          const saved = await p.savedFunnels();
          return JSON.stringify({ ok: true, analytics: p.vendor, source: p.sourceSlug, savedFunnels: saved, note: saved.length > 0 ? 'Give steps, or a saved funnel id from this list.' : 'Give the steps, as event names in order.' });
        }
        const funnel = await p.funnel({ ...range, steps: args.steps, savedFunnelId: args.saved_funnel_id, windowDays: args.window_days ?? 7 });
        return JSON.stringify({ ok: true, analytics: p.vendor, source: p.sourceSlug, project: p.project, link: p.projectUrl, funnel, note: 'Shares are 0–1. fromPrevious is the step-to-step conversion; fromStart the share of everyone who began.' });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: ANALYTICS_FUNNEL_TOOL,
      description: 'Conversion through steps in order in the connected product analytics project: how many people did each step, and the share who went on from the previous and from the first. Give the steps as event names (Amplitude builds any funnel), or a saved funnel id (Mixpanel reads saved funnels; call with neither to list them). Defaults to the last 30 days.',
      schema: z.object({
        steps: z.array(z.string().min(1).max(300)).min(2).max(10).optional().describe('Event names in order, as analytics_events lists them.'),
        saved_funnel_id: z.string().max(100).optional().describe('A saved funnel\'s id, from the list this tool returns when called with neither.'),
        from: day.optional().describe('First day, YYYY-MM-DD.'),
        to: day.optional().describe('Last day, YYYY-MM-DD, inclusive.'),
        window_days: z.number().int().min(1).max(90).optional().describe('Days a person has to finish after the first step (default 7).'),
        source: sourceArg,
      }),
    },
  );
}

function cohortsTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const p = await provider(ctx, args.source);
        const cohorts = await p.cohorts();
        return JSON.stringify({ ok: true, analytics: p.vendor, source: p.sourceSlug, project: p.project, link: p.projectUrl, count: cohorts.length, cohorts });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: ANALYTICS_COHORTS_TOOL,
      description: 'The saved cohorts in the connected product analytics project (Mixpanel or Amplitude): name, description, how many people are in each, and when it was last computed. Names only, never the people.',
      schema: z.object({ source: sourceArg }),
    },
  );
}
