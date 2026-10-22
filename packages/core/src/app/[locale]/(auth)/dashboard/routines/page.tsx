import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { ListPage } from '@/components/patterns';
import { PracticeRoutineButton } from '@/features/routines/PracticeRoutineButton';
import { RoutineList } from '@/features/routines/RoutineList';
import { TeachRoutineButton } from '@/features/routines/TeachRoutineButton';
import { clerkAuth as auth } from '@/libs/Auth';
import { listRoutines } from '@/services/routines/routineReads';

export const metadata: Metadata = { title: 'Routines' };

/**
 * The workspace's routines: repeatable work a specialist taught once from a
 * recording, each with its expert, its trust level and how its runs have gone.
 * Reads `routineReads` only — the light module — so the page compiles without
 * the service that drives runs (the build budget, CI.yml "Build memory").
 * @param props - The route.
 * @param props.params - Its params.
 */
export default async function RoutinesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const routines = orgId ? await listRoutines(orgId) : [];
  return (
    <ListPage
      title="Routines"
      description="Teach Vocion repeatable work, then manage how it runs."
      actions={routines.length > 0
        ? (
            <>
              <PracticeRoutineButton variant="outline" />
              <TeachRoutineButton />
            </>
          )
        : undefined}
    >
      <RoutineList routines={routines} />
    </ListPage>
  );
}
