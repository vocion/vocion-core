import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { ListPage } from '@/components/patterns';
import { PracticeRoutineButton } from '@/features/routines/PracticeRoutineButton';
import { RoutineBatchView } from '@/features/routines/RoutineBatchView';
import { RoutineList } from '@/features/routines/RoutineList';
import { RoutineView } from '@/features/routines/RoutineView';
import { TeachRoutineButton } from '@/features/routines/TeachRoutineButton';
import { clerkAuth as auth } from '@/libs/Auth';
import { batchesOf, getBatch, getRoutine, listRoutines } from '@/services/routines/routineReads';

/** What a path under /dashboard/automations shows. */
type Shown = { kind: 'list' } | { kind: 'routine'; id: number } | { kind: 'batch'; id: number } | { kind: 'batches' } | { kind: 'none' };

function shown(path: string[] | undefined): Shown {
  const [a, b, ...rest] = path ?? [];
  const id = (s: string | undefined) => (s && /^\d{1,12}$/.test(s) ? Number(s) : null);
  if (rest.length > 0) {
    return { kind: 'none' };
  }
  if (a === undefined) {
    return { kind: 'list' };
  }
  if (a === 'batches') {
    if (b === undefined) {
      return { kind: 'batches' };
    }
    const n = id(b);
    return n ? { kind: 'batch', id: n } : { kind: 'none' };
  }
  const n = id(a);
  return n && b === undefined ? { kind: 'routine', id: n } : { kind: 'none' };
}

export async function generateMetadata(props: { params: Promise<{ path?: string[] }> }): Promise<Metadata> {
  const s = shown((await props.params).path);
  return { title: s.kind === 'routine' ? 'Automation' : s.kind === 'batch' ? 'Automation run' : 'Automations' };
}

/**
 * Every Automations page in one route — the list, one routine, one batch's queue —
 * so the build compiles the Automations pages once (the build budget, CI.yml
 * "Build memory"). Reads `routineReads` only, the light module.
 *
 *   /dashboard/automations              the workspace's routines
 *   /dashboard/automations/<id>         one routine: spec, questions, trust, Run it, batches
 *   /dashboard/automations/batches/<id> one batch, as its queue
 * @param props - The route.
 * @param props.params - Its params.
 */
export default async function AutomationsPage(props: { params: Promise<{ locale: string; path?: string[] }> }) {
  const { locale, path } = await props.params;
  setRequestLocale(locale);
  const s = shown(path);
  if (s.kind === 'none') {
    notFound();
  }
  if (s.kind === 'batches') {
    // Batches are listed on their routine's page; the trail's "Batches" crumb lands on the routines.
    redirect('/dashboard/automations');
  }
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }
  if (s.kind === 'routine') {
    const routine = await getRoutine(orgId, s.id);
    if (!routine) {
      notFound();
    }
    return <RoutineView key={routine.id} initial={routine} batches={await batchesOf(orgId, s.id)} />;
  }
  if (s.kind === 'batch') {
    const batch = await getBatch(orgId, s.id);
    if (!batch) {
      notFound();
    }
    return <RoutineBatchView key={batch.id} initial={batch} />;
  }
  const routines = await listRoutines(orgId);
  return (
    <ListPage
      title="Automations"
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
