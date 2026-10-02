import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { fireFailedLine, startingFireId } from '@/libs/worker/runLog';
import { automationRunSchema } from '@/models/Schema';

/**
 * WHAT A MISSION RUN'S FIRE SAYS, when it failed. A review is a mission run
 * started by an automation fire, and the fire is where the review's outcome
 * lands: the run can finish cleanly while the fire errors because the verdict
 * never recorded (2026-09-27, #131: five reviews read "completed"). One read
 * for every surface that states a mission run's status — the feature page's
 * activity rows and the run's preview.
 * @param orgId - Tenant.
 * @param runs - The mission runs, with their `causedBy`.
 * @returns For each run id whose starting fire errored, the fire's status in words ("failed: …").
 */
export async function failedFireLines(orgId: string, runs: Array<{ id: number; causedBy: unknown }>): Promise<Map<number, string>> {
  const fireOf = new Map<number, number>();
  for (const r of runs) {
    const fire = startingFireId(r.causedBy);
    if (fire !== null) {
      fireOf.set(r.id, fire);
    }
  }
  const out = new Map<number, string>();
  if (fireOf.size === 0) {
    return out;
  }
  const fires = await db
    .select({ id: automationRunSchema.id, error: automationRunSchema.error })
    .from(automationRunSchema)
    .where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.status, 'error'), inArray(automationRunSchema.id, [...new Set(fireOf.values())])));
  const failed = new Map(fires.map(f => [f.id, f.error]));
  for (const [runId, fireId] of fireOf) {
    if (failed.has(fireId)) {
      out.set(runId, fireFailedLine(failed.get(fireId) ?? null));
    }
  }
  return out;
}
