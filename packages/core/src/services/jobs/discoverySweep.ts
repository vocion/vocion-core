/**
 * discovery-sweep — the built-in automation job that runs the discovery-call
 * detection funnel on a schedule (ticket 011). Params come from the automation's
 * `do.input` (authored in workspace YAML, applied to the DB), so the scheduled
 * run and the manual CLI share one source of truth.
 */

import { z } from 'zod';
import { runSweep } from '@/services/DiscoveryDetectionService';

const inputSchema = z.object({
  sellerDomain: z.string().min(1),
  eligible: z
    .object({
      ownerIds: z.array(z.string()).optional(),
      lifecycleStages: z.array(z.string()).optional(),
      dealStages: z.array(z.string()).optional(),
    })
    .default({}),
  sinceDays: z.number().positive().default(3),
  discoveryThreshold: z.number().min(0).max(1).default(0.6),
  readyThreshold: z.number().min(0).max(1).default(0.75),
  allowCalendlyExternal: z.boolean().optional(),
  supervised: z.boolean().default(true),
});

export async function runDiscoverySweepJob(orgId: string, input: Record<string, unknown>): Promise<unknown> {
  const cfg = inputSchema.parse(input);
  return runSweep(orgId, {
    eligible: cfg.eligible,
    sellerDomain: cfg.sellerDomain,
    sinceDays: cfg.sinceDays,
    discoveryThreshold: cfg.discoveryThreshold,
    readyThreshold: cfg.readyThreshold,
    allowCalendlyExternal: cfg.allowCalendlyExternal,
    supervised: cfg.supervised,
  });
}
