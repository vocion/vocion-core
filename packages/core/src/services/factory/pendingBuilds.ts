import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';

/**
 * Build cards waiting on a person, by request: every `factory.dispatch_task`
 * still pending and undecided. The Work queue reads these so a request whose
 * Build card is up says so on its row (journey 4, 2026-09-28: request #214's
 * card #4945 was pending and the row read as queued). The newest card wins
 * when a request has several.
 * @param orgId - Tenant.
 */
export async function loadPendingBuilds(orgId: string): Promise<Array<{ requestId: number; runId: number; at: Date | null }>> {
  const rows = await db
    .select({ id: actionRunSchema.id, input: actionRunSchema.input, createdAt: actionRunSchema.createdAt })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, 'factory.dispatch_task'),
      eq(actionRunSchema.status, 'pending'),
      isNull(actionRunSchema.decidedAt),
    ));
  const byRequest = new Map<number, { requestId: number; runId: number; at: Date | null }>();
  for (const r of rows) {
    const requestId = Number((r.input ?? {} as Record<string, unknown>).requestId);
    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
      continue;
    }
    const seen = byRequest.get(requestId);
    if (!seen || seen.runId < r.id) {
      byRequest.set(requestId, { requestId, runId: r.id, at: r.createdAt ?? null });
    }
  }
  return [...byRequest.values()];
}
