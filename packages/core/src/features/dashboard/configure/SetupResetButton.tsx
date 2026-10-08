'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/**
 * The admin's way to run a plugin's onboarding again (Jamie, 2026-10-07: "I
 * need a button to wipe the integration so we can retest the onboarding
 * process"). One tap asks; the second does it: disconnects the connectors
 * the plugin's setup names, deletes the records of the types it names with
 * their artifacts, and rejects the proposals still waiting to create them.
 * The server refuses anyone who is not a workspace admin.
 * @param props - The plugin and whether any step is done (nothing to reset otherwise).
 * @param props.plugin - Plugin slug.
 * @param props.anythingToReset - False when no step is done; the control then says so.
 */
export function SetupResetButton(props: { plugin: string; anythingToReset: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!props.anythingToReset) {
    return <p className="text-xs text-muted-foreground" data-testid="setup-reset-nothing">Nothing set up yet — there is nothing to reset.</p>;
  }
  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await client.setup.reset({ plugin: props.plugin });
      const records = res.deleted.reduce((n, d) => n + d.records, 0);
      const creds = res.disconnected.reduce((n, d) => n + d.credentials, 0);
      setNote(`Reset: ${creds} credential${creds === 1 ? '' : 's'} revoked, ${records} record${records === 1 ? '' : 's'} deleted, ${res.rejected} proposal${res.rejected === 1 ? '' : 's'} rejected.`);
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'could not reset');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="setup-reset">
      {note && <p className="text-muted-foreground">{note}</p>}
      {confirming
        ? (
            <>
              <p className="text-muted-foreground">Disconnect the connectors, delete the records and their artifacts, reject what is waiting — and start over?</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="destructive" disabled={busy} onClick={run} data-testid="setup-reset-confirm">
                  {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                  Reset setup
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Keep</Button>
              </div>
            </>
          )
        : (
            <div>
              <Button size="sm" variant="outline" onClick={() => setConfirming(true)} data-testid="setup-reset-ask">Reset setup</Button>
            </div>
          )}
    </div>
  );
}
