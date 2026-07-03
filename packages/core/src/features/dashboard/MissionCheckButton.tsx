'use client';

import { Loader2, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/**
 * "Check now" — fires the same judgment pass the mission's automation runs
 * on its schedule, then navigates to the resulting run.
 * @param root0
 * @param root0.slug
 */
export function MissionCheckButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await client.missions.check({ slug });
      router.push(`/dashboard/missions/runs/${res.runId}`);
    } catch {
      setError('Check failed to start.');
      setRunning(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button onClick={onClick} disabled={running}>
        {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        {running ? 'Checking…' : 'Check now'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
