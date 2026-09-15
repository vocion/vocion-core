/**
 * `apollo_usage` — the credit guardrail.
 *
 * Apollo's usage endpoint reports per-endpoint quota per minute, hour and day,
 * and requires a MASTER API key. An ordinary key gets a 403, which is why this
 * tool is written to degrade honestly rather than to fail: the client records
 * the rate-limit headers Apollo stamps on every response, and when the
 * master-key path is closed the tool reports from that cache and NAMES that as
 * its source.
 *
 * The two are never conflated, and neither is ever guessed. A tool that
 * invented a remaining balance would be worse than no guardrail at all: the
 * whole point of it is to be the number someone trusts before spending.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { observedRateSnapshot } from '@/libs/apollo/client';
import { APOLLO_ROUTING, apolloClientForCtx } from './apolloDirect';
import { asJson } from './hubspotDirect';

type UsageBody = Record<string, unknown>;

export function apolloUsageTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const resolved = await apolloClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const res = await resolved.client.get<UsageBody>('/api/v1/usage_stats/api_usage_stats');
      if (res.ok) {
        return asJson({
          ok: true,
          source: 'apollo_live',
          reported_from: 'usage_stats_endpoint',
          note: 'Live per-endpoint quota from Apollo\'s usage-stats endpoint, current as of this call. These are REQUEST rate limits, not a credit balance: Apollo does not expose remaining credits over the API, so never state one.',
          usage: res.data,
        });
      }
      // The master-key 403 is the expected case, not a failure. Fall back to
      // what was observed, and say that is what it is.
      const observed = observedRateSnapshot(ctx.orgId);
      if (!observed) {
        return asJson({
          ok: true,
          source: 'apollo_live',
          reported_from: 'nothing_observed_yet',
          usage: null,
          message: `${(res as { message: string }).message} No Apollo call has been made in this process yet, so there are no observed rate-limit headers to report either. Say that quota is unknown rather than estimating it.`,
        });
      }
      return asJson({
        ok: true,
        source: 'apollo_live',
        reported_from: 'observed_response_headers',
        note: `This key is not a master key, so live usage stats are closed (${(res as { message: string }).message}). What follows was observed from Apollo's own response headers on the last call, at ${observed.observedAt}, and is not a credit balance.`,
        observed_at: observed.observedAt,
        observed_on_path: observed.path,
        minute: observed.minute,
        hourly: observed.hourly,
        daily: observed.daily,
        raw_headers: observed.headers,
      });
    },
    {
      name: 'apollo_usage',
      description: `Reports Apollo API quota: per-endpoint per-minute / hour / day limits from Apollo's usage-stats endpoint when the workspace holds a MASTER key, and otherwise from the rate-limit headers observed on the last Apollo call. \`reported_from\` says which — quote it, because the two mean different things. These are REQUEST limits, never a credit balance: Apollo does not expose remaining credits over the API, so never state or estimate one. Use before a bulk enrich to check there is room to run it. ${APOLLO_ROUTING}`,
      schema: z.object({}),
    },
  );
}

/**
 * The account tools, source-gated as a set.
 * @param ctx - The agent runtime context.
 */
export function apolloAccountTools(ctx: RuntimeContext) {
  return [apolloUsageTool(ctx)];
}
