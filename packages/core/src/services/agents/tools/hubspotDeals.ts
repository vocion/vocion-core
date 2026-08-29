/**
 * Direct-to-HubSpot DEAL tools — the pipeline-hygiene view.
 *
 * `hubspot_list_deals` lists OPEN deals only (closed-won / closed-lost
 * excluded by the pipeline definitions, so custom pipelines resolve
 * correctly), oldest-modified first. `stalled_only` narrows to deals past
 * their per-stage age threshold, most overdue first.
 *
 * Stall thresholds are CONFIG, not guesses: `stallThresholds: {stageId:
 * days}` in the hubspot source's configJson. Unconfigured → the tool says so
 * and refuses to guess which deals count as stalled.
 */

import type { RuntimeContext } from '../types';
import type { HubspotPage } from '@/libs/hubspot/client';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { asJson, clampLimit, hubspotClientForCtx } from './hubspotDirect';

const LIST_DEAL_PROPS = [
  'dealname',
  'dealstage',
  'pipeline',
  'amount',
  'closedate',
  'createdate',
  'hs_lastmodifieddate',
  'hubspot_owner_id',
];

/**
 * The configured per-stage stall thresholds, from the first hubspot-family
 * source that carries `configJson.stallThresholds` ({stageId: maxDays}).
 * @param sources
 */
export function stallThresholdsFrom(sources: Array<{ configJson: Record<string, unknown> | null }>): Record<string, number> | undefined {
  for (const source of sources) {
    const raw = source.configJson?.stallThresholds;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const entries = Object.entries(raw as Record<string, unknown>)
        .filter(([, v]) => Number.isFinite(Number(v)) && Number(v) > 0)
        .map(([k, v]) => [k, Number(v)] as const);
      if (entries.length > 0) {
        return Object.fromEntries(entries);
      }
    }
  }
  return undefined;
}

export function hubspotListDealsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { stalled_only, pipeline_id, limit } = args as {
        stalled_only?: boolean;
        pipeline_id?: string;
        limit?: number;
      };
      const resolved = await hubspotClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const cap = clampLimit(limit, 50, 200);
      const thresholds = stallThresholdsFrom(resolved.sources);
      if (stalled_only && !thresholds) {
        return asJson({
          ok: false,
          error: 'stall_thresholds_unconfigured',
          message: 'No stall thresholds are configured for this workspace (the hubspot source\'s configJson.stallThresholds maps stage id to max days in stage), so "stalled" has no defined meaning here. Say the thresholds are unconfigured rather than guessing; the unfiltered open-deal list (stalled_only=false, oldest-modified first) is still available.',
          deals: [],
        });
      }

      // Open = not closed per the pipeline definitions, so custom pipelines
      // whose stage names give no hint still resolve correctly.
      const stagesRes = await resolved.client.fetchDealStages();
      if (!stagesRes.ok) {
        return asJson(stagesRes);
      }
      const stages = stagesRes.data;
      const openStageIds = [...stages.entries()]
        .filter(([, s]) => !s.isClosed && (!pipeline_id || s.pipelineId === pipeline_id))
        .map(([id]) => id);
      if (openStageIds.length === 0) {
        return asJson({
          ok: false,
          error: 'bad_argument',
          message: pipeline_id
            ? `No open stages found for pipeline_id "${pipeline_id}". Check the pipeline id, or omit it for all pipelines.`
            : 'HubSpot returned no open deal stages for this portal.',
          deals: [],
        });
      }

      const res = await resolved.client.post<HubspotPage>('/crm/v3/objects/deals/search', {
        limit: cap,
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
        properties: LIST_DEAL_PROPS,
        filterGroups: [{ filters: [{ propertyName: 'dealstage', operator: 'IN', values: openStageIds }] }],
      });
      if (!res.ok) {
        return asJson(res);
      }

      const now = Date.now();
      const perStage: Record<string, number> = {};
      let stalledCount = 0;
      let deals = (res.data.results ?? []).map((row) => {
        const p = row.properties ?? {};
        const stage = p.dealstage ? stages.get(p.dealstage) : undefined;
        const stageLabel = stage?.label ?? p.dealstage ?? '(unknown)';
        const lastModified = p.hs_lastmodifieddate ? Date.parse(p.hs_lastmodifieddate) : Number.NaN;
        const days = Number.isFinite(lastModified) ? Math.floor((now - lastModified) / 86_400_000) : null;
        const threshold = thresholds?.[p.dealstage ?? ''] ?? null;
        const daysOverdue = days !== null && threshold !== null ? days - threshold : null;
        if (daysOverdue !== null && daysOverdue > 0) {
          stalledCount += 1;
        }
        perStage[stageLabel] = (perStage[stageLabel] ?? 0) + 1;
        return {
          deal_id: row.id,
          name: p.dealname ?? null,
          stage: stageLabel,
          stage_id: p.dealstage ?? null,
          pipeline: stage?.pipelineLabel ?? null,
          amount: p.amount ?? null,
          days_since_modified: days,
          threshold_days: threshold,
          days_overdue: daysOverdue,
          owner_id: p.hubspot_owner_id ?? null,
          last_modified: p.hs_lastmodifieddate ?? null,
        };
      });

      if (stalled_only) {
        // Most overdue first — stall-report ordering.
        deals = deals
          .filter(d => d.days_overdue !== null && d.days_overdue > 0)
          .sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0));
      }
      // else: HubSpot already returned oldest-modified first.

      return asJson({
        ok: true,
        source: 'hubspot_live',
        total_open: res.data.total ?? null,
        returned: deals.length,
        stalled_count: stalledCount,
        per_stage: perStage,
        thresholds_configured: Boolean(thresholds),
        ...(thresholds ? { thresholds } : {}),
        ...(pipeline_id ? { pipeline_id } : {}),
        deals,
      });
    },
    {
      name: 'hubspot_list_deals',
      description: 'Reads HubSpot LIVE, current as of this call: OPEN deals only (closed-won and closed-lost excluded via the pipeline definitions), oldest-modified first — the pipeline-hygiene view. stalled_only=true narrows to deals past their configured per-stage age threshold, most overdue first, each with days_overdue + threshold_days; when no thresholds are configured on the hubspot source it says so instead of guessing. Routing: a company\'s FULL deal history including closed/lost deals → hubspot_company_deals; totals and value-by-stage → hubspot_count_deals on the synced mirror, whose sums cover every match.',
      schema: z.object({
        stalled_only: z.boolean().optional().describe('Only deals past their stage\'s configured threshold, most overdue first.'),
        pipeline_id: z.string().optional().describe('Restrict to one HubSpot pipeline id. Omit for all pipelines.'),
        limit: z.number().int().positive().optional().describe('Max deals to return (default 50, max 200).'),
      }),
    },
  );
}

export function hubspotDealTools(ctx: RuntimeContext) {
  return [hubspotListDealsTool(ctx)];
}
