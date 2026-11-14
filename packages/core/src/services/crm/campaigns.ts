import type { ListActor } from '@/services/lists/service';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { writeListSchema } from '@/libs/lists/spec';
import { workspaceListSchema as lists, listRecordSchema as records, listRevisionSchema as revisions } from '@/models/Schema';
import { ListError, writeListRecords } from '@/services/lists/service';
import { planningListIds } from './planning';
import { requireCrmActor } from './sync';

const decision = z.object({
  recordId: z.string().uuid(),
  recordVersion: z.number().int().positive(),
  decision: z.enum(['approve', 'changes', 'cancel']),
  notes: z.string().trim().max(2000),
  scheduledAt: z.string().nullable(),
});
export const campaignCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), ...writeListSchema.shape }),
  z.object({ action: z.literal('review'), id: z.string().uuid(), expectedVersion: z.number().int().positive(), recordId: z.string().uuid(), recordVersion: z.number().int().positive(), decision: decision.shape.decision, notes: decision.shape.notes }),
]);

function planningId(actor: ListActor, id: string) {
  if (!planningListIds(actor.orgId).includes(id)) {
    throw new ListError('Campaign not found', 404);
  }
}

// Planning labels in editable cells never confer approval. Only server-written
// audit events count, and they authorize exactly one immutable record revision.
export async function campaignPlans(actor: ListActor, kind: 'weekly' | 'outreach', offset = 0) {
  const who = await requireCrmActor(actor);
  const id = planningListIds(actor.orgId)[kind === 'weekly' ? 1 : 0]!;
  return db.transaction(async (tx) => {
    const [list] = await tx.select().from(lists).where(and(eq(lists.id, id), eq(lists.projectId, actor.orgId), eq(lists.scope, 'workspace'), eq(lists.archived, false)));
    if (!list) {
      throw new ListError('Run the CRM sync to install campaign planning.', 404);
    }
    const rows = await tx.select().from(records).where(eq(records.listId, id)).orderBy(desc(records.updatedAt), records.id).limit(21).offset(offset);
    const page = rows.slice(0, 20);
    const history = page.length ? await tx.selectDistinctOn([sql`${revisions.change} -> 'campaignReview' ->> 'recordId'`]).from(revisions).where(and(eq(revisions.listId, id), inArray(sql`${revisions.change} -> 'campaignReview' ->> 'recordId'`, page.map(r => r.id)))).orderBy(sql`${revisions.change} -> 'campaignReview' ->> 'recordId'`, desc(revisions.version)) : [];
    return {
      list,
      canReview: who.role === 'admin',
      nextOffset: rows.length > 20 ? offset + 20 : null,
      rows: page.map((row) => {
        const event = history.find(h => (h.change.campaignReview as { recordId?: string })?.recordId === row.id);
        const parsed = decision.safeParse(event?.change.campaignReview);
        const review = parsed.success && event ? { ...parsed.data, actorId: event.actorId, reviewedAt: event.createdAt } : null;
        const current = review?.recordVersion === row.version;
        const state = !review ? 'draft' : !current ? 'stale' : review.decision === 'cancel' ? 'cancelled' : review.decision === 'changes' ? 'changes' : review.scheduledAt && new Date(review.scheduledAt).getTime() <= Date.now() ? 'due' : 'scheduled';
        return { ...row, review, state };
      }),
    };
  }, { isolationLevel: 'repeatable read' });
}

function schedule(values: typeof records.$inferSelect['values'], weekly: boolean) {
  const required = ['name', 'subject', 'body', 'sender', 'proposed_at', 'timezone', 'evidence', ...(weekly ? ['audience', 'exclusions', 'preview'] : ['recipient', 'contact_url', 'reason'])];
  const missing = required.filter(key => typeof values[key] !== 'string' || !String(values[key]).trim());
  if (missing.length) {
    throw new ListError(`Complete before review: ${missing.join(', ')}`);
  }
  if (!z.string().email().safeParse(values.sender).success || (!weekly && !z.string().email().safeParse(values.recipient).success)) {
    throw new ListError('Use a valid sender and recipient email.');
  }
  // Offset is mandatory: ambiguous local/DST times must never silently shift.
  if (!z.string().datetime({ offset: true }).safeParse(values.proposed_at).success) {
    throw new ListError('Schedule must be an ISO date and time with an explicit UTC offset.');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: String(values.timezone) }).format();
  } catch {
    throw new ListError('Use a valid IANA timezone.');
  }
  const at = new Date(String(values.proposed_at));
  if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) {
    throw new ListError('Choose a future time. Past dry-run slots never replay automatically.');
  }
  return at.toISOString();
}

export async function changeCampaign(actor: ListActor, input: z.input<typeof campaignCommand>) {
  const args = campaignCommand.parse(input);
  planningId(actor, args.id);
  await requireCrmActor(actor, args.action === 'review');
  if (args.action === 'save') {
    return writeListRecords(actor, args);
  }
  return db.transaction(async (tx) => {
    // Same lock as every native List write: edits and decisions serialize.
    const [list] = await tx.select().from(lists).where(and(eq(lists.id, args.id), eq(lists.projectId, actor.orgId), eq(lists.scope, 'workspace'), eq(lists.archived, false))).for('update');
    if (!list) {
      throw new ListError('Campaign not found', 404);
    }
    if (list.version !== args.expectedVersion) {
      throw new ListError('The plan changed. Reload and review the latest copy.', 409);
    }
    const [record] = await tx.select().from(records).where(and(eq(records.id, args.recordId), eq(records.listId, list.id)));
    if (!record || record.version !== args.recordVersion) {
      throw new ListError('The draft changed. Reload and review it again.', 409);
    }
    const scheduledAt = args.decision === 'approve' ? schedule(record.values, list.id === planningListIds(actor.orgId)[1]) : null;
    const version = list.version + 1;
    await tx.update(lists).set({ version, updatedAt: new Date() }).where(eq(lists.id, list.id));
    await tx.insert(revisions).values({ listId: list.id, version, actorId: actor.userId, change: { campaignReview: decision.parse({ ...args, scheduledAt }) } });
    // This is a local planning receipt, never a provider or background send job.
    return { id: list.id, version, scheduledAt, delivery: 'held' as const };
  });
}
