'use client';

import { Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/**
 * Add an app to this workspace: every feature it lists switches on in one
 * apply (`plugins.addApp`), and the page reloads so the app's switches, its
 * place in the rail and its Open button all show at once. A failure stays
 * beside the button, in words. An admin action; the page shows a member the
 * state instead.
 * @param props
 * @param props.id - The app id.
 * @param props.name - The app's name, for the label.
 */
export function AddAppButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await client.plugins.addApp({ id });
      if (res.applied && res.applied.errors > 0) {
        setError(`${name} was added, with ${res.applied.errors} problem${res.applied.errors === 1 ? '' : 's'} to fix in Context.`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not add ${name}.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button onClick={() => void add()} disabled={busy} data-testid={`add-app-${id}`}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {busy ? `Adding ${name}…` : `Add ${name}`}
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
