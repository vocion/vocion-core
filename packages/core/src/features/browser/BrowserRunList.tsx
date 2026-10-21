'use client';

import type { BrowserRunView } from '@/libs/browser/run';
import { Globe } from 'lucide-react';
import { useState } from 'react';
import { StatusDot } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { browserRunLabel } from '@/libs/browser/run';
import { Link, useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

const TONE: Record<string, 'pass' | 'amber' | 'fail' | 'neutral'> = { done: 'pass', running: 'amber', queued: 'amber', waiting: 'amber', proposed: 'neutral', stopped: 'neutral', failed: 'fail' };

/**
 * The person's runs, and the practice task: a supplier portal with no API,
 * served inside the browser, that shows a sign-in, a table read into outputs
 * and a save held for approval (`services/browser/practiceSite.ts`).
 * @param props - The runs.
 * @param props.runs - Newest first.
 */
export function BrowserRunList({ runs }: { runs: BrowserRunView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const practice = async () => {
    setBusy(true);
    setError(null);
    const json = await client.browser.practice().catch(() => ({ run: null, error: 'It did not start.' }));
    setBusy(false);
    if (json.run) {
      router.push(`/dashboard/browser/${json.run.id}`);
    } else {
      setError(json.error ?? 'It did not start.');
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 pb-4">
        <Button size="sm" variant="outline" disabled={busy} onClick={practice} data-browser-practice>
          <Globe className="size-3.5" aria-hidden />
          Run the practice task
        </Button>
        <p className="text-[13px] text-muted-foreground">Or ask in any chat: “use the browser to …”.</p>
        {error && <p className="text-[12px] text-brand-fail" role="alert">{error}</p>}
      </div>
      {runs.length === 0
        ? <p className="py-8 text-center text-sm text-muted-foreground">No browser runs yet.</p>
        : (
            <ul className="divide-y divide-border/60">
              {runs.map(r => (
                <li key={r.id}>
                  <Link href={`/dashboard/browser/${r.id}`} className="flex items-baseline gap-3 py-2.5 hover:bg-muted/30">
                    <span className="w-28 shrink-0 text-[12px] text-muted-foreground">{browserRunLabel(r.id)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.task}</span>
                    <StatusDot tone={TONE[r.status] ?? 'neutral'} label={<span className="text-[12px] text-muted-foreground">{r.status}</span>} className="shrink-0" />
                    <span className="w-24 shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">{new Date(r.createdAt).toLocaleDateString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}
