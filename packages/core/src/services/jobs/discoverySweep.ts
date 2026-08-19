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
  /**
   * Replay one specific UTC day (`YYYY-MM-DD`) instead of the trailing window.
   * Resolves to `now` = end of that day with `sinceDays` = 1, so "run it for
   * last Tuesday" needs no separate query path. Overrides `sinceDays`.
   */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD').optional(),
  /** Explicit window upper bound. `day` sets this; tests inject it directly. */
  now: z.coerce.date().optional(),
  /** Rehearsal: classify and report, but enqueue nothing and route nothing. */
  dryRun: z.boolean().default(false),
});

export async function runDiscoverySweepJob(orgId: string, input: Record<string, unknown>): Promise<unknown> {
  const cfg = inputSchema.parse(input);
  // A named day is a one-day window ending at that day's UTC midnight-end.
  const dayEnd = cfg.day ? new Date(`${cfg.day}T00:00:00.000Z`) : null;
  if (dayEnd) {
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  }
  return runSweep(orgId, {
    eligible: cfg.eligible,
    sellerDomain: cfg.sellerDomain,
    sinceDays: dayEnd ? 1 : cfg.sinceDays,
    discoveryThreshold: cfg.discoveryThreshold,
    readyThreshold: cfg.readyThreshold,
    allowCalendlyExternal: cfg.allowCalendlyExternal,
    supervised: cfg.supervised,
    now: dayEnd ?? cfg.now,
    dryRun: cfg.dryRun,
  });
}
