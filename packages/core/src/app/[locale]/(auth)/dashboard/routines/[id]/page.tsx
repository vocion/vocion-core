import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { RoutineView } from '@/features/routines/RoutineView';
import { clerkAuth as auth } from '@/libs/Auth';
import { batchesOf, getRoutine } from '@/services/routines/routineReads';

export const metadata: Metadata = { title: 'Routine' };

/**
 * One routine: its spec as its expert approves it, its open questions, the
 * trust ladder, "Run it", and its batches — the same view the chat pane draws
 * beside the conversation that taught it (`features/routines/RoutineView`).
 * @param props - The route.
 * @param props.params - Its params.
 */
export default async function RoutinePage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const routineId = Number.parseInt(id, 10);
  if (!orgId || !Number.isSafeInteger(routineId) || routineId <= 0) {
    notFound();
  }
  const routine = await getRoutine(orgId, routineId);
  if (!routine) {
    notFound();
  }
  const batches = await batchesOf(orgId, routineId);
  return <RoutineView key={routine.id} initial={routine} batches={batches} />;
}
