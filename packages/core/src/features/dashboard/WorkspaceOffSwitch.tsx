'use client';

import { Loader2, Pause, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { client } from '@/libs/Orpc';

/**
 * The workspace off switch: the control in the top bar, and the banner that
 * replaces it once the switch is pulled.
 *
 * **Why the top bar and not the workspace page.** `/dashboard/workspace` is
 * the Context map — an overview someone opens on purpose, occasionally. The
 * top bar is on every authenticated page, it already names the workspace, and
 * it is where a person is when they decide to stop everything. A stop nobody
 * can find is not a stop, so it goes where people already are: one click from
 * wherever they happen to be, phone included.
 *
 * **The banner is not a notification.** It is the workspace's state, shown at
 * the top of every page in it until someone lifts it, naming who stopped it,
 * when, and why — and saying plainly what is still running, because "paused"
 * on its own reads as "nothing is happening" and a worker mid-run is
 * happening.
 *
 * Both halves are server-rendered from the project row (`AppShell`), so there
 * is no flash of a running workspace on a paused one, and the date is
 * formatted once on the server — a browser locale that disagrees with the
 * server's would otherwise hydrate to a mismatch.
 */

/** The hold as a surface shows it — already words, never a `Date`. */
export type WorkspacePauseView = {
  /** Who pulled the switch: their name, or their id when the account is gone. */
  byName: string;
  /** "Sep 21, 3:14 PM UTC" — formatted on the server. */
  when: string;
  note: string | null;
};

/** What a pause still lets through, said plainly — the banner shows it verbatim. */
const STILL_RUNNING = 'A worker already mid-run finishes and reports, and chat with an agent stays open.';

/** What it refuses. Four things, the same four the guard enforces. */
const REFUSED = 'No automation fires, no mission run starts, no worker run is queued or claimed, and no gated action executes.';

/**
 * The control, for a workspace that is running. One button; the note is asked
 * for in the dialog, because a stop with no reason is a banner nobody can act
 * on and the note is the only part of it that says what to do.
 * @param props
 * @param props.canPause - Admins only. A member sees nothing here rather than a button that 403s.
 */
export function WorkspacePauseButton({ canPause }: { canPause: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canPause) {
    return null;
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.workspace.pause({ note: note.trim() });
      setOpen(false);
      setNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="workspace-pause"
        // The label stays at phone width (#501): an unlabelled icon is not a
        // control anyone reaches for in a hurry, and a hurry is when this one
        // is used.
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground sm:px-3"
      >
        <Pause className="size-4 shrink-0" aria-hidden />
        <span>
          Pause
          <span className="hidden sm:inline"> workspace</span>
        </span>
      </button>

      <Dialog open={open} onOpenChange={next => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pause this workspace</DialogTitle>
            <DialogDescription>
              {REFUSED}
              {' '}
              {STILL_RUNNING}
              {' '}
              Automations someone paused individually stay paused — resuming puts everything back exactly as it is now.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="workspace-pause-note" className="mb-1 block text-xs font-medium text-muted-foreground">
              Why? Everyone in this workspace sees this until it is resumed.
            </label>
            <input
              id="workspace-pause-note"
              type="text"
              value={note}
              maxLength={500}
              onChange={e => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy && note.trim() !== '') {
                  void submit();
                }
              }}
              placeholder="e.g. holding the factory until the release goes out"
              className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm"
            />
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy || note.trim() === ''} data-testid="workspace-pause-confirm">
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
              {busy ? 'Pausing…' : 'Pause workspace'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The banner, for a workspace that is paused. Across the top of every page in
 * the workspace, above the content and under the top bar, until someone lifts
 * it.
 *
 * Amber rather than red on purpose: nothing is broken. Somebody made a
 * decision, and the banner's job is to carry that decision — and its reason —
 * to everyone else who opens the app.
 * @param props
 * @param props.pause - Who, when, why.
 * @param props.canResume - Admins only; everyone else reads the name and knows who to ask.
 */
export function WorkspacePausedBanner({ pause, canResume }: { pause: WorkspacePauseView; canResume: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resume = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.workspace.resume();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // A CONFLICT means somebody resumed it in another tab; a refresh is the
      // fix either way.
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="workspace-paused-banner"
      className="shrink-0 border-b border-brand-amber/40 bg-brand-amber/10 px-3 py-2.5 lg:px-6"
    >
      {/* Column on a phone, row from `sm` up: the sentence must never be
          truncated to fit a button beside it. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            <span className="font-semibold">This workspace is paused.</span>
            {' '}
            {pause.note ?? 'No reason was given.'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Paused by
            {' '}
            <span className="font-medium text-foreground/80">{pause.byName}</span>
            {' '}
            {pause.when}
            .
            {' '}
            {REFUSED}
            {' '}
            {STILL_RUNNING}
          </p>
          {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
        {canResume && (
          <button
            type="button"
            onClick={resume}
            disabled={busy}
            data-testid="workspace-resume"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-full border border-border bg-background px-3.5 text-[13px] font-medium transition-colors hover:bg-surface-hover disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            {busy ? 'Resuming…' : 'Resume'}
          </button>
        )}
      </div>
    </div>
  );
}
