import type { ListActor } from '@/services/lists/service';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { startJob } from '@/libs/durable/jobs';
import { crmSyncSchema } from '@/models/Schema';
import { JOB } from '@/services/background/catalog';
import { requireCrmActor } from './sync';

export async function startCrmSync(actor: ListActor) {
  await requireCrmActor(actor, true);
  // Retries in the same minute attach to the same job; the page-level lease
  // protects manual and scheduled runs that overlap across minutes.
  const id = `crm-sync:${actor.orgId}:${Math.floor(Date.now() / 60000)}`;
  await startJob(id, { job: JOB.crmSync, input: actor });
  return { jobId: id, queued: true };
}

export async function refreshInstalledCrm(orgId: string) {
  const [sync] = await db.select({ userId: crmSyncSchema.actorId }).from(crmSyncSchema).where(eq(crmSyncSchema.projectId, orgId));
  if (sync) {
    await startCrmSync({ orgId, userId: sync.userId });
  }
}
