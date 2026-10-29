'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/**
 * "Review yesterday now" — runs the day's usage review by hand, the same run
 * the Workspace manager starts each morning. Says what happened in one line.
 */
export function RunUsageReview() {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; line: string | null }>({ busy: false, line: null });
  const run = async () => {
    setState({ busy: true, line: null });
    try {
      const r = await client.usageReview.run();
      setState({ busy: false, line: r.skipped === 'no_activity' ? 'Nobody used this workspace in the last day.' : r.skipped ? `Not run: ${r.skipped.replace(/_/g, ' ')}.` : 'Published. It is at the top of the list.' });
      router.refresh();
    } catch {
      setState({ busy: false, line: 'The review could not run. Try again in a minute.' });
    }
  };
  return (
    <div className="flex items-center gap-3">
      {state.line && <span role="status" className="text-[13px] text-muted-foreground">{state.line}</span>}
      <Button size="sm" onClick={() => void run()} disabled={state.busy}>{state.busy ? 'Reviewing…' : 'Review yesterday now'}</Button>
    </div>
  );
}
