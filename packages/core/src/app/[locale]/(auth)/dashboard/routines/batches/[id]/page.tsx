import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { RoutineBatchView } from '@/features/routines/RoutineBatchView';
import { clerkAuth as auth } from '@/libs/Auth';
import { getBatch } from '@/services/routines/routineReads';

export const metadata: Metadata = { title: 'Routine batch' };

/**
 * One batch of a routine's runs, as a queue: a live tile per row, what each
 * waits on, its receipt when it is done, and what the batch found beyond its
 * rows — the same view the chat pane draws (`features/routines/RoutineBatchView`).
 * @param props - The route.
 * @param props.params - Its params.
 */
export default async function RoutineBatchPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const batchId = Number.parseInt(id, 10);
  if (!orgId || !Number.isSafeInteger(batchId) || batchId <= 0) {
    notFound();
  }
  const batch = await getBatch(orgId, batchId);
  if (!batch) {
    notFound();
  }
  return <RoutineBatchView key={batch.id} initial={batch} />;
}
