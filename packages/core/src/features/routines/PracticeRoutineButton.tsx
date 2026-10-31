'use client';

/**
 * THE PRACTICE ROUTINE — "Add a user and enroll them (practice)", already
 * taught and approved on the practice training console, so the whole shape can
 * be seen without recording anything: the spec, Run it, and a batch for the
 * console's 20-person roster (`routines.practice`, like browser runs' practice
 * task). `run` starts that batch and opens its queue; otherwise it opens the
 * routine.
 */

import { FlaskConical, Play } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { openPreview } from '@/features/preview/previewState';
import { useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/**
 * A routine is the practice one by its name (`routines.practice` names it so).
 * @param name
 */
export function isPracticeRoutine(name: string): boolean {
  return /\(practice\)\s*$/i.test(name);
}

/**
 * @param props - The button.
 * @param props.run - Start a batch for the practice roster, and open its queue.
 * @param props.compact - In the pane: open the batch beside the conversation.
 * @param props.variant - How loud it is.
 */
export function PracticeRoutineButton({ run = false, compact = false, variant = 'outline' }: { run?: boolean; compact?: boolean; variant?: 'default' | 'outline' | 'secondary' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    const res = await client.routines.practice({ run }).catch(() => ({ routine: null, batch: null, error: 'It did not start.' }));
    setBusy(false);
    if (run && res.batch) {
      if (compact) {
        openPreview({ type: 'routine_batch', id: String(res.batch.id) }, null);
      } else {
        router.push(`/dashboard/automations/batches/${res.batch.id}`);
      }
    } else if (!run && res.routine) {
      router.push(`/dashboard/automations/${res.routine.id}`);
    } else {
      setError(res.error ?? 'It did not start.');
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant={variant} disabled={busy} onClick={() => void go()} data-routine-practice={run ? 'run' : 'open'}>
        {run ? <Play className="size-3.5" aria-hidden /> : <FlaskConical className="size-3.5" aria-hidden />}
        {busy ? 'Starting…' : run ? 'Run it for the practice roster' : 'Try the practice automation'}
      </Button>
      {error && <span className="text-[12px] text-brand-fail" role="alert">{error}</span>}
    </span>
  );
}
