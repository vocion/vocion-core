import { redirect } from 'next/navigation';

/** Batches are listed on their routine's page; the trail's "Batches" crumb lands on the routines. */
export default function RoutineBatchesPage() {
  redirect('/dashboard/routines');
}
