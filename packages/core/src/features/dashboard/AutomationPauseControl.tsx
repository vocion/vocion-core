'use client';

import { Loader2, Pause, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client } from '@/libs/Orpc';

/**
 * The pause a surface shows — already resolved to words on the server, so the
 * client renders the same string it was handed and never formats a date of
 * its own (a locale that differs between server and browser would otherwise
 * hydrate to a mismatch).
 */
export type PauseState = {
  /** The person's name, or their id when the account is gone. */
  byName: string;
  /** "Sep 20, 3:14 PM" — formatted where the row was read. */
  when: string;
  note: string | null;
};

/**
 * Pause / Resume for one automation, with the record it leaves.
 *
 * Before this the page could READ that a schedule was paused — `paused` came
 * back from Temporal — and nothing in the app could pause or resume one, so
 * the only way to hold an automation was the Temporal UI or a shell, and
 * neither said who did it or why. Now the hold is a person's act: the button
 * asks for an optional note, the server names the actor from the session, and
 * the list and the detail page show "Paused by <name> <when>: <note>" until
 * someone resumes it — also on the record.
 *
 * One control for both directions, one shape on the card and the detail page.
 * @param props
 * @param props.slug - Which automation.
 * @param props.paused - The standing pause, or null when it is running.
 */
export function AutomationPauseControl({ slug, paused }: { slug: string; paused: PauseState | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = paused ? 'resume' : 'pause';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const input = { slug, note: note.trim() === '' ? undefined : note.trim() };
      if (action === 'pause') {
        await client.automations.pause(input);
      } else {
        await client.automations.resume(input);
      }
      setOpen(false);
      setNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // A CONFLICT means the state on screen is stale; a refresh is the fix
      // either way, and the message says so.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const button = 'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60';

  return (
    <div className="flex flex-col items-start gap-2 text-xs">
      {paused && (
        <p className="text-amber-600" data-testid="automation-paused-by">
          Paused by
          {' '}
          <span className="font-medium">{paused.byName}</span>
          {' '}
          {paused.when}
          {paused.note ? `: ${paused.note}` : ''}
        </p>
      )}

      {!open
        ? (
            <button type="button" onClick={() => setOpen(true)} className={button}>
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          )
        : (
            <div className="w-full max-w-md rounded-md border border-border bg-muted/30 p-3">
              <label htmlFor={`${action}-note-${slug}`} className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {paused ? 'Why resume? (optional, goes on the record)' : 'Why pause? (optional, goes on the record)'}
              </label>
              <input
                id={`${action}-note-${slug}`}
                type="text"
                value={note}
                maxLength={500}
                onChange={e => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) {
                    void submit();
                  }
                }}
                placeholder={paused ? 'e.g. CRM sync is back' : 'e.g. holding until the CRM sync is fixed'}
                className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
              />
              <p className="mb-2 text-[11px] text-muted-foreground">
                {paused
                  ? 'The schedule fires again from its next tick; event fires match again at once.'
                  : 'No fire will start until someone resumes it. A workspace apply keeps it paused.'}
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={submit} disabled={busy} className={`${button} bg-background`}>
                  {busy
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                  {paused ? 'Resume now' : 'Pause now'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setError(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

      {error && (
        <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
