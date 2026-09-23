import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ListPage } from '@/components/patterns';
import { BulkJobProgress } from '@/features/personalization/BulkJobProgress';
import { clerkAuth as auth } from '@/libs/Auth';
import { getBulkJob } from '@/services/personalization/bulkRegenerate';

/**
 * One bulk job (Metacto ticket 071): the counts and every lead's outcome,
 * live while it runs, and the record afterwards.
 * @param props
 * @param props.params
 */
export default async function BulkJobPage(props: { params: Promise<{ locale: string; jobId: string }> }) {
  const { locale, jobId } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }
  const id = Number(jobId);
  const job = Number.isInteger(id) && id > 0 ? await getBulkJob(orgId, id) : null;
  if (!job) {
    notFound();
  }
  return (
    <ListPage
      title={`Regenerate ${job.total} ${job.total === 1 ? 'brief' : 'briefs'}`}
      description={`Started ${job.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. Each lead's brief is written again, its sequence picked again under the current rules, and its sends redrafted. Every card waits in Review.`}
    >
      <BulkJobProgress initial={{ id: job.id, kind: job.kind, note: job.note, total: job.total, done: job.done, failed: job.failed, status: job.status, outcomes: job.outcomes, createdAt: job.createdAt.toISOString() }} />
    </ListPage>
  );
}
